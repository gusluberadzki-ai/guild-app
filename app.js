const LS_USERS_KEY = "guild.local.users";
const LS_CURRENT_UID = "guild.local.currentUid";
const LS_DB_KEY = "guild.local.db";
const GOOGLE_CLIENT_ID =
  "1051878033789-3c7a0439nd9gvksop09s4rns6ecjsgf8.apps.googleusercontent.com";

const auth = { currentUser: null, listeners: [] };
const db = {};

const loadUsers = () => JSON.parse(localStorage.getItem(LS_USERS_KEY) || "[]");
const saveUsers = (users) => localStorage.setItem(LS_USERS_KEY, JSON.stringify(users));
const loadDb = () =>
  JSON.parse(localStorage.getItem(LS_DB_KEY) || '{"profiles":{},"admin_requests":{}}');
const saveDb = (value) => localStorage.setItem(LS_DB_KEY, JSON.stringify(value));

const publicUser = (record) =>
  record
    ? {
        uid: record.uid,
        email: record.email,
        displayName: record.displayName || "",
        photoURL: record.photoURL || "",
      }
    : null;

const notifyAuthListeners = () => {
  auth.listeners.forEach((cb) => cb(auth.currentUser));
};

const bootstrapAuth = () => {
  const users = loadUsers();
  const currentUid = localStorage.getItem(LS_CURRENT_UID);
  const current = users.find((u) => u.uid === currentUid);
  auth.currentUser = publicUser(current);
};

const onAuthStateChanged = (_auth, callback) => {
  auth.listeners.push(callback);
  callback(auth.currentUser);
  return () => {
    auth.listeners = auth.listeners.filter((cb) => cb !== callback);
  };
};

const createUserWithEmailAndPassword = async (_auth, email, password) => {
  const users = loadUsers();
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("Email already in use.");
  }
  const record = {
    uid: crypto.randomUUID(),
    email,
    password,
    displayName: "",
    photoURL: "",
  };
  users.push(record);
  saveUsers(users);
  localStorage.setItem(LS_CURRENT_UID, record.uid);
  auth.currentUser = publicUser(record);
  notifyAuthListeners();
  return { user: auth.currentUser };
};

const signInWithEmailAndPassword = async (_auth, email, password) => {
  const users = loadUsers();
  const record = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );
  if (!record) {
    throw new Error("Invalid email or password.");
  }
  localStorage.setItem(LS_CURRENT_UID, record.uid);
  auth.currentUser = publicUser(record);
  notifyAuthListeners();
  return { user: auth.currentUser };
};

let googleScriptPromise = null;
let googleTokenClient = null;

const loadGoogleIdentityScript = async () => {
  if (window.google?.accounts?.oauth2) return;
  if (googleScriptPromise) {
    await googleScriptPromise;
    return;
  }
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Google Identity Services."));
    document.head.appendChild(script);
  });
  await googleScriptPromise;
};

const signInWithGoogleProfile = async (profile) => {
  if (!profile?.email) {
    throw new Error("Google account email was not returned.");
  }
  const email = profile.email;
  const users = loadUsers();
  let record = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!record) {
    record = {
      uid: crypto.randomUUID(),
      email,
      password: "",
      displayName: profile.name || email.split("@")[0],
      photoURL: profile.picture || "",
      provider: "google",
    };
    users.push(record);
  } else {
    record.displayName = profile.name || record.displayName || email.split("@")[0];
    record.photoURL = profile.picture || record.photoURL || "";
    const idx = users.findIndex((u) => u.uid === record.uid);
    users[idx] = record;
  }
  saveUsers(users);
  localStorage.setItem(LS_CURRENT_UID, record.uid);
  auth.currentUser = publicUser(record);
  notifyAuthListeners();
  return { user: auth.currentUser };
};

const signInWithPopup = async () => {
  await loadGoogleIdentityScript();
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity Services not available.");
  }
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("Google client ID is missing.");
  }

  const accessToken = await new Promise((resolve, reject) => {
    const callback = (tokenResponse) => {
      if (!tokenResponse || tokenResponse.error) {
        reject(new Error(tokenResponse?.error_description || tokenResponse?.error || "Google sign-in failed."));
        return;
      }
      resolve(tokenResponse.access_token);
    };
    if (!googleTokenClient) {
      googleTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "openid email profile",
        callback,
      });
    } else {
      googleTokenClient.callback = callback;
    }
    googleTokenClient.requestAccessToken({ prompt: "select_account" });
  });

  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!profileResponse.ok) {
    throw new Error("Google profile request failed.");
  }
  const profile = await profileResponse.json();
  return signInWithGoogleProfile(profile);
};

const updateProfile = async (user, payload) => {
  if (!user) throw new Error("No active user.");
  const users = loadUsers();
  const idx = users.findIndex((u) => u.uid === user.uid);
  if (idx === -1) throw new Error("User not found.");
  users[idx] = { ...users[idx], ...payload };
  saveUsers(users);
  auth.currentUser = publicUser(users[idx]);
  notifyAuthListeners();
};

const updatePassword = async (user, newPassword) => {
  if (!user) throw new Error("No active user.");
  const users = loadUsers();
  const idx = users.findIndex((u) => u.uid === user.uid);
  if (idx === -1) throw new Error("User not found.");
  users[idx].password = newPassword;
  saveUsers(users);
};

const firebaseSignOut = async () => {
  localStorage.removeItem(LS_CURRENT_UID);
  auth.currentUser = null;
  notifyAuthListeners();
};

const doc = (_db, collectionName, id) => ({ collectionName, id });
const setDoc = async (refObj, data, options = {}) => {
  const store = loadDb();
  if (!store[refObj.collectionName]) store[refObj.collectionName] = {};
  const current = store[refObj.collectionName][refObj.id] || {};
  store[refObj.collectionName][refObj.id] = options.merge
    ? { ...current, ...data }
    : { ...data };
  saveDb(store);
};
const getDoc = async (refObj) => {
  const store = loadDb();
  const value = store?.[refObj.collectionName]?.[refObj.id];
  return {
    exists: () => !!value,
    data: () => value,
  };
};
const updateDoc = async (refObj, data) => {
  const store = loadDb();
  if (!store[refObj.collectionName]) store[refObj.collectionName] = {};
  const current = store[refObj.collectionName][refObj.id] || {};
  store[refObj.collectionName][refObj.id] = { ...current, ...data };
  saveDb(store);
};
const collection = (_db, collectionName) => ({ collectionName });
const where = (field, op, value) => ({ field, op, value });
const query = (collectionRef, ...filters) => ({ collectionRef, filters });
const getDocs = async (queryRef) => {
  const store = loadDb();
  const source = store?.[queryRef.collectionRef.collectionName] || {};
  let docs = Object.values(source);
  queryRef.filters.forEach((f) => {
    if (f.op === "==") docs = docs.filter((d) => d?.[f.field] === f.value);
  });
  return {
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach((item) => cb({ data: () => item })),
  };
};
const serverTimestamp = () => Date.now();

bootstrapAuth();
const LOCAL_AI_ENDPOINT = "http://localhost:8787/assess-upload";
const REMOTE_AI_ENDPOINT = "/api/assess";
const getAiEndpoint = () => {
  const forced = localStorage.getItem("guild.aiRoute");
  if (forced === "local") return LOCAL_AI_ENDPOINT;
  if (forced === "firebase" || forced === "remote") return REMOTE_AI_ENDPOINT;
  return window.location.hostname === "localhost" ? LOCAL_AI_ENDPOINT : "";
};

const ADMIN_EMAIL = "gus.luberadzki@gmail.com";
const CONTACT_EMAIL = "gus.luberadzki@gmail.com";

const languageOptions = [
  { code: "en", label: "English" },
  { code: "es", label: "Espanol" },
  { code: "fr", label: "Francais" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Portugues" },
  { code: "ru", label: "Russkiy" },
  { code: "uk", label: "Ukrainska" },
  { code: "pl", label: "Polski" },
  { code: "tr", label: "Turkce" },
  { code: "nl", label: "Nederlands" },
  { code: "sv", label: "Svenska" },
  { code: "no", label: "Norsk" },
  { code: "da", label: "Dansk" },
  { code: "fi", label: "Suomi" },
  { code: "is", label: "Islenska" },
  { code: "ga", label: "Gaeilge" },
  { code: "cy", label: "Cymraeg" },
  { code: "cs", label: "Cestina" },
  { code: "sk", label: "Slovencina" },
  { code: "sl", label: "Slovenscina" },
  { code: "hr", label: "Hrvatski" },
  { code: "sr", label: "Srpski" },
  { code: "bs", label: "Bosanski" },
  { code: "hu", label: "Magyar" },
  { code: "ro", label: "Romana" },
  { code: "bg", label: "Balgarski" },
  { code: "el", label: "Ellinika" },
  { code: "sq", label: "Shqip" },
  { code: "mk", label: "Makedonski" },
  { code: "be", label: "Belaruskaya" },
  { code: "lv", label: "Latviesu" },
  { code: "lt", label: "Lietuviu" },
  { code: "et", label: "Eesti" },
  { code: "mt", label: "Malti" },
  { code: "ca", label: "Catala" },
  { code: "eu", label: "Euskara" },
  { code: "ja", label: "Nihongo" },
  { code: "zh-CN", label: "JianTi ZhongWen" },
  { code: "zh-TW", label: "FanTi ZhongWen" },
];

const i18n = {
  en: {
    navHome: "Home",
    navQuests: "Quests",
    navVerify: "Verify",
    navIgcse: "IGCSE",
    navIb: "IB",
    navStats: "Stats",
    navAbout: "About",
    navContact: "Contact",
    navAccount: "Account",
    viewStats: "View Stats",
    startQuest: "Start Quest",
    heroPill: "Compliance-first education",
    heroTitle: "Quest-based learning that builds real-world habits.",
    heroBody:
      "Kids record learning or home-help tasks. The AI validates completion and rewards points instantly. Sponsors can fund skill-based quests while keeping tasks safe and education-focused.",
    verifyHomework: "Verify Homework",
    settingsTitle: "Settings",
    settingsClose: "Close",
    settingsTheme: "Theme",
    settingsLanguage: "Language",
    settingsCompact: "Compact cards",
    themeDark: "Dark",
    themeLight: "Light",
    themeRed: "Red",
    themePurple: "Purple",
  },
  es: { navHome: "Inicio", navQuests: "Misiones", navVerify: "Verificar", navIgcse: "IGCSE", navIb: "IB", navStats: "Estadisticas", navAbout: "Acerca de", navContact: "Contacto", navAccount: "Cuenta", viewStats: "Ver Estadisticas", startQuest: "Comenzar Mision", heroPill: "Educacion centrada en cumplimiento", heroTitle: "Aprendizaje por misiones para habitos reales.", heroBody: "Los ninos registran tareas de estudio o ayuda en casa. La IA valida y otorga puntos al instante.", verifyHomework: "Verificar tarea", settingsTitle: "Configuracion", settingsClose: "Cerrar", settingsTheme: "Tema", settingsLanguage: "Idioma", settingsCompact: "Tarjetas compactas", themeDark: "Oscuro", themeLight: "Claro", themeRed: "Rojo", themePurple: "Morado" },
  fr: { navHome: "Accueil", navQuests: "Quetes", navVerify: "Verifier", navIgcse: "IGCSE", navIb: "IB", navStats: "Statistiques", navAbout: "A propos", navContact: "Contact", navAccount: "Compte", viewStats: "Voir stats", startQuest: "Demarrer quete", heroPill: "Education conforme", heroTitle: "Un apprentissage par quetes pour des habitudes reelles.", heroBody: "Les enfants enregistrent leurs taches d'apprentissage et l'IA valide rapidement.", verifyHomework: "Verifier devoir", settingsTitle: "Parametres", settingsClose: "Fermer", settingsTheme: "Theme", settingsLanguage: "Langue", settingsCompact: "Cartes compactes", themeDark: "Sombre", themeLight: "Clair", themeRed: "Rouge", themePurple: "Violet" },
  de: { navHome: "Start", navQuests: "Quests", navVerify: "Prufen", navIgcse: "IGCSE", navIb: "IB", navStats: "Statistik", navAbout: "Uber uns", navContact: "Kontakt", navAccount: "Konto", viewStats: "Statistik anzeigen", startQuest: "Quest starten", heroPill: "Regelkonforme Bildung", heroTitle: "Quest-basiertes Lernen fur echte Gewohnheiten.", heroBody: "Kinder dokumentieren Lernen und Hilfe zuhause. KI bewertet sofort.", verifyHomework: "Hausaufgaben prufen", settingsTitle: "Einstellungen", settingsClose: "Schliessen", settingsTheme: "Design", settingsLanguage: "Sprache", settingsCompact: "Kompakte Karten", themeDark: "Dunkel", themeLight: "Hell", themeRed: "Rot", themePurple: "Lila" },
  it: { navHome: "Home", navQuests: "Missioni", navVerify: "Verifica", navIgcse: "IGCSE", navIb: "IB", navStats: "Statistiche", navAbout: "Chi siamo", navContact: "Contatto", navAccount: "Account", viewStats: "Vedi statistiche", startQuest: "Inizia missione", heroPill: "Educazione conforme", heroTitle: "Apprendimento a missioni per abitudini reali.", heroBody: "I ragazzi registrano compiti e attivita. L'IA valuta subito.", verifyHomework: "Verifica compiti", settingsTitle: "Impostazioni", settingsClose: "Chiudi", settingsTheme: "Tema", settingsLanguage: "Lingua", settingsCompact: "Schede compatte", themeDark: "Scuro", themeLight: "Chiaro", themeRed: "Rosso", themePurple: "Viola" },
  pt: { navHome: "Inicio", navQuests: "Missoes", navVerify: "Verificar", navIgcse: "IGCSE", navIb: "IB", navStats: "Estatisticas", navAbout: "Sobre", navContact: "Contato", navAccount: "Conta", viewStats: "Ver estatisticas", startQuest: "Iniciar missao", heroPill: "Educacao em conformidade", heroTitle: "Aprendizagem por missoes com habitos reais.", heroBody: "Criancas registram tarefas e a IA valida rapidamente.", verifyHomework: "Verificar dever", settingsTitle: "Configuracoes", settingsClose: "Fechar", settingsTheme: "Tema", settingsLanguage: "Idioma", settingsCompact: "Cartoes compactos", themeDark: "Escuro", themeLight: "Claro", themeRed: "Vermelho", themePurple: "Roxo" },
  ru: { navHome: "Glavnaya", navQuests: "Zadaniya", navVerify: "Proverka", navIgcse: "IGCSE", navIb: "IB", navStats: "Statistika", navAbout: "O nas", navContact: "Kontakt", navAccount: "Akkount", viewStats: "Smotret statistiku", startQuest: "Nachat zadanie", heroPill: "Bezopasnaya obrazovatelnaya model", heroTitle: "Obuchenie v formate zadaniy dlya realnyh privychek.", heroBody: "Deti zagruzhayut dokazy vypolneniya, a II proveryaet i nachislyaet ochki.", verifyHomework: "Proverit domashnee zadanie", settingsTitle: "Nastroyki", settingsClose: "Zakryt", settingsTheme: "Tema", settingsLanguage: "Yazyk", settingsCompact: "Kompaktnye kartochki", themeDark: "Temnaya", themeLight: "Svetlaya", themeRed: "Krasnaya", themePurple: "Fioletovaya" },
  uk: { navHome: "Golovna", navQuests: "Zavdannya", navVerify: "Perevirka", navIgcse: "IGCSE", navIb: "IB", navStats: "Statistika", navAbout: "Pro nas", navContact: "Kontakt", navAccount: "Akaunt", viewStats: "Pereglyanuty statystyku", startQuest: "Pochaty zavdannya", heroPill: "Bezpechna osvita", heroTitle: "Navchannya cherez zavdannya dlya realnyh zvychok.", heroBody: "Dity zavantazhuyut dokazy, a SI pereviryaye ta narahovuye bali.", verifyHomework: "Pereviryty domashnye", settingsTitle: "Nalashtuvannya", settingsClose: "Zakryty", settingsTheme: "Tema", settingsLanguage: "Mova", settingsCompact: "Kompaktni kartky", themeDark: "Temna", themeLight: "Svitla", themeRed: "Chervona", themePurple: "Fioletova" },
  pl: { navHome: "Start", navQuests: "Zadania", navVerify: "Weryfikuj", navIgcse: "IGCSE", navIb: "IB", navStats: "Statystyki", navAbout: "O nas", navContact: "Kontakt", navAccount: "Konto", viewStats: "Zobacz statystyki", startQuest: "Rozpocznij zadanie", heroPill: "Edukacja zgodna z zasadami", heroTitle: "Nauka oparta na zadaniach i prawdziwych nawykach.", heroBody: "Uczniowie nagrywaja dowody, a AI ocenia i przyznaje punkty.", verifyHomework: "Sprawdz prace", settingsTitle: "Ustawienia", settingsClose: "Zamknij", settingsTheme: "Motyw", settingsLanguage: "Jezyk", settingsCompact: "Kompaktowe karty", themeDark: "Ciemny", themeLight: "Jasny", themeRed: "Czerwony", themePurple: "Fioletowy" },
  tr: { navHome: "Ana sayfa", navQuests: "Gorevler", navVerify: "Dogrula", navIgcse: "IGCSE", navIb: "IB", navStats: "Istatistik", navAbout: "Hakkinda", navContact: "Iletisim", navAccount: "Hesap", viewStats: "Istatistik gor", startQuest: "Gorev baslat", heroPill: "Uyum odakli egitim", heroTitle: "Gercek aliskanliklar icin gorev tabanli ogrenme.", heroBody: "Cocuklar kanit yukler, YZ dogrular ve puan verir.", verifyHomework: "Odevi dogrula", settingsTitle: "Ayarlar", settingsClose: "Kapat", settingsTheme: "Tema", settingsLanguage: "Dil", settingsCompact: "Kompakt kartlar", themeDark: "Koyu", themeLight: "Acik", themeRed: "Kirmizi", themePurple: "Mor" },
  ja: { navHome: "Home", navQuests: "Quest", navVerify: "Verify", navIgcse: "IGCSE", navIb: "IB", navStats: "Stats", navAbout: "About", navContact: "Contact", navAccount: "Account", viewStats: "Stats", startQuest: "Quest Start", heroPill: "Education", heroTitle: "Quest learning for real habits.", heroBody: "Students upload evidence and AI checks progress.", verifyHomework: "Verify Homework", settingsTitle: "Settings", settingsClose: "Close", settingsTheme: "Theme", settingsLanguage: "Language", settingsCompact: "Compact cards", themeDark: "Dark", themeLight: "Light", themeRed: "Red", themePurple: "Purple" },
  "zh-CN": { navHome: "Home", navQuests: "Quests", navVerify: "Verify", navIgcse: "IGCSE", navIb: "IB", navStats: "Stats", navAbout: "About", navContact: "Contact", navAccount: "Account", viewStats: "View Stats", startQuest: "Start Quest", heroPill: "Education", heroTitle: "Quest-based learning.", heroBody: "Students upload evidence and AI checks progress.", verifyHomework: "Verify Homework", settingsTitle: "Settings", settingsClose: "Close", settingsTheme: "Theme", settingsLanguage: "Language", settingsCompact: "Compact cards", themeDark: "Dark", themeLight: "Light", themeRed: "Red", themePurple: "Purple" },
  "zh-TW": { navHome: "Home", navQuests: "Quests", navVerify: "Verify", navIgcse: "IGCSE", navIb: "IB", navStats: "Stats", navAbout: "About", navContact: "Contact", navAccount: "Account", viewStats: "View Stats", startQuest: "Start Quest", heroPill: "Education", heroTitle: "Quest-based learning.", heroBody: "Students upload evidence and AI checks progress.", verifyHomework: "Verify Homework", settingsTitle: "Settings", settingsClose: "Close", settingsTheme: "Theme", settingsLanguage: "Language", settingsCompact: "Compact cards", themeDark: "Dark", themeLight: "Light", themeRed: "Red", themePurple: "Purple" },
};

const defaultAbout =
  "Guild is a quest-based learning platform that helps children build consistent, voluntary habits through safe, education-first tasks. We verify effort with recorded evidence, reward progress instantly, and create a reliable activity history for future learning opportunities. Our mission is to align motivation, accountability, and wellbeing without turning learning into labor.";

const quests = [
  {
    id: 1,
    title: "Math Mastery - 20 mins",
    type: "learning",
    reward: 120,
    description: "Solve 10 practice problems. Record your workspace.",
    exercises: [
      "Complete 10 algebraic simplifications.",
      "Show steps for 3 long division problems.",
      "Record a 2-minute reflection on what was hardest.",
    ],
    questions: [
      "Simplify: 3(2x - 5) + 4x.",
      "Factorize: x^2 - 9.",
      "Evaluate: 5x - 2 when x = -3.",
    ],
  },
  {
    id: 2,
    title: "Read & Reflect",
    type: "learning",
    reward: 90,
    description: "Read 6 pages and summarize key points on video.",
    exercises: [
      "Read 6 pages of your chosen text.",
      "List 3 key points and explain them on video.",
      "Write a 3-sentence summary in your own words.",
    ],
    questions: [
      "What is the main idea of the section you read?",
      "List two supporting details and explain why they matter.",
      "Write a 2-sentence summary using your own words.",
    ],
  },
  {
    id: 3,
    title: "Room Reset",
    type: "home",
    reward: 80,
    description: "Tidy your desk and floor. Show before/after.",
    exercises: [
      "Take a before photo of your desk area.",
      "Organize books and supplies into categories.",
      "Take an after photo and explain what changed.",
    ],
    questions: [
      "What was the biggest source of clutter?",
      "How did you decide where items should go?",
      "What will you do to keep it organized?",
    ],
  },
  {
    id: 4,
    title: "Dishes Helper",
    type: "home",
    reward: 70,
    description: "Rinse and stack dishes. Show final counter.",
    exercises: [
      "Rinse and stack dishes safely.",
      "Wipe the counter.",
      "Record a 15-second video of the finished area.",
    ],
    questions: [
      "What steps did you follow to stay safe?",
      "How long did the task take?",
      "What would you improve next time?",
    ],
  },
  {
    id: 5,
    title: "Sponsor: Basic Coding",
    type: "sponsored",
    reward: 160,
    description: "Complete a short coding lesson and explain what you built.",
    exercises: [
      "Build a small loop that prints 1 to 5.",
      "Explain what the loop does in a short video.",
      "Save your code snippet as proof.",
    ],
    questions: [
      "What does a loop do in programming?",
      "Write a loop that prints numbers 1 to 5.",
      "How would you change it to print 5 to 1?",
    ],
  },
  {
    id: 6,
    title: "Sponsor: English Vocabulary",
    type: "sponsored",
    reward: 140,
    description: "Learn 8 new words and use them in a sentence on video.",
    exercises: [
      "List 8 new words with definitions.",
      "Create 4 sentences using the new words.",
      "Record a 60-second video reading them aloud.",
    ],
    questions: [
      "Choose 3 words and use each in a different sentence.",
      "Explain the difference between two similar words.",
      "Which word was the hardest and why?",
    ],
  },
];

const sponsors = [
  { name: "FutureWorks", points: 300, skill: "Problem Solving" },
  { name: "BrightEd", points: 250, skill: "Digital Literacy" },
  { name: "GreenPath", points: 200, skill: "Communication" },
];

const timelineEntries = [
  "No activity yet. Complete a quest to begin.",
];

const ibSubjects = [
  { name: "English A: Language and Literature", code: "IB-ENG-A" },
  { name: "English B", code: "IB-ENG-B" },
  { name: "Mathematics: Analysis and Approaches", code: "IB-MATH-AA" },
  { name: "Mathematics: Applications and Interpretation", code: "IB-MATH-AI" },
  { name: "Physics", code: "IB-PHY" },
  { name: "Chemistry", code: "IB-CHEM" },
  { name: "Biology", code: "IB-BIO" },
  { name: "Computer Science", code: "IB-CS" },
  { name: "Economics", code: "IB-ECON" },
  { name: "Business Management", code: "IB-BM" },
  { name: "History", code: "IB-HIST" },
  { name: "Geography", code: "IB-GEO" },
  { name: "Psychology", code: "IB-PSY" },
  { name: "Global Politics", code: "IB-GP" },
  { name: "Philosophy", code: "IB-PHIL" },
  { name: "Visual Arts", code: "IB-VA" },
  { name: "Music", code: "IB-MUS" },
  { name: "French B", code: "IB-FR-B" },
  { name: "Spanish B", code: "IB-SP-B" },
];

const igcseFallback = [
  { name: "Accounting", code: "0452" },
  { name: "Accounting (9-1)", code: "0985" },
  { name: "Afrikaans - Second Language", code: "0548" },
  { name: "Agriculture", code: "0600" },
  { name: "Arabic - First Language", code: "0508" },
  { name: "Arabic - First Language (9-1)", code: "7184" },
  { name: "Arabic - Foreign Language", code: "0544" },
  { name: "Arabic (9-1)", code: "7180" },
  { name: "Art & Design", code: "0400" },
  { name: "Art & Design (9-1)", code: "0989" },
  { name: "Bahasa Indonesia", code: "0538" },
  { name: "Biology", code: "0610" },
  { name: "Biology (9-1)", code: "0970" },
  { name: "Business", code: "0264" },
  { name: "Business (9-1)", code: "0774" },
  { name: "Business Studies", code: "0450" },
  { name: "Business Studies (9-1)", code: "0986" },
  { name: "Chemistry", code: "0620" },
  { name: "Chemistry (9-1)", code: "0971" },
  { name: "Chinese - First Language", code: "0509" },
  { name: "Chinese - Second Language", code: "0523" },
  { name: "Chinese (Mandarin) - Foreign Language", code: "0547" },
  { name: "Commerce", code: "0715" },
  { name: "Computer Science", code: "0478" },
  { name: "Computer Science (9-1)", code: "0984" },
  { name: "Design & Technology", code: "0445" },
  { name: "Design & Technology (9-1)", code: "0979" },
  { name: "Drama", code: "0411" },
  { name: "Drama (9-1)", code: "0994" },
  { name: "Economics", code: "0455" },
  { name: "Economics (9-1)", code: "0987" },
  { name: "English - First Language", code: "0500" },
  { name: "English - First Language (9-1)", code: "0990" },
  { name: "English - First Language (US)", code: "0524" },
  { name: "English - Literature (US)", code: "0427" },
  { name: "English - Literature in English", code: "0475" },
  { name: "English - Literature in English (9-1)", code: "0992" },
  { name: "English (as an Additional Language)", code: "0472" },
  { name: "English (as an Additional Language) (9-1)", code: "0772" },
  { name: "English (Core) as a Second Language (Egypt)", code: "0465" },
  { name: "English as a Second Language (Count-in speaking)", code: "0511" },
  { name: "English as a Second Language (Count-in Speaking) (9-1)", code: "0991" },
  { name: "English as a Second Language (Speaking endorsement)", code: "0510" },
  { name: "English as a Second Language (Speaking Endorsement) (9-1)", code: "0993" },
  { name: "Enterprise", code: "0454" },
  { name: "Environmental Management", code: "0680" },
  { name: "Food & Nutrition", code: "0648" },
  { name: "French - First Language", code: "0501" },
  { name: "French - Foreign Language", code: "0520" },
  { name: "French (9-1)", code: "7156" },
  { name: "Geography", code: "0460" },
  { name: "Geography (9-1)", code: "0976" },
  { name: "German - First Language", code: "0505" },
  { name: "German - Foreign Language", code: "0525" },
  { name: "German (9-1)", code: "7159" },
  { name: "Global Perspectives", code: "0457" },
  { name: "Hindi as a Second Language", code: "0549" },
  { name: "History", code: "0470" },
  { name: "History - American (US)", code: "0409" },
  { name: "History (9-1)", code: "0977" },
  { name: "Information and Communication Technology", code: "0417" },
  { name: "Information and Communication Technology (9-1)", code: "0983" },
  { name: "IsiZulu as a Second Language", code: "0531" },
  { name: "Islamiyat", code: "0493" },
  { name: "Italian - Foreign Language", code: "0535" },
  { name: "Italian (9-1)", code: "7164" },
  { name: "Japanese - Foreign Language", code: "0716" },
  { name: "Latin", code: "0480" },
  { name: "Malay - First Language", code: "0696" },
  { name: "Malay - Foreign Language", code: "0546" },
  { name: "Marine Science", code: "0697" },
  { name: "Mathematics", code: "0580" },
  { name: "Mathematics - Additional", code: "0606" },
  { name: "Mathematics - International", code: "0607" },
  { name: "Mathematics (9-1)", code: "0980" },
  { name: "Mathematics (US)", code: "0444" },
  { name: "Music", code: "0410" },
  { name: "Music (9-1)", code: "0978" },
  { name: "Pakistan Studies", code: "0448" },
  { name: "Physical Education", code: "0413" },
  { name: "Physical Education (9-1)", code: "0995" },
  { name: "Physical Science", code: "0652" },
  { name: "Physics", code: "0625" },
  { name: "Physics (9-1)", code: "0972" },
  { name: "Portuguese - First Language", code: "0504" },
  { name: "Psychology", code: "0266" },
  { name: "Religious Studies", code: "0490" },
  { name: "Sanskrit", code: "0499" },
  { name: "Science - Combined", code: "0653" },
  { name: "Sciences - Co-ordinated (9-1)", code: "0973" },
  { name: "Sciences - Co-ordinated (Double)", code: "0654" },
  { name: "Setswana - First Language", code: "0698" },
  { name: "Sociology", code: "0495" },
  { name: "Spanish - First Language", code: "0502" },
  { name: "Spanish - Foreign Language", code: "0530" },
  { name: "Spanish - Literature", code: "0488" },
  { name: "Spanish - Literature in Spanish", code: "0474" },
  { name: "Spanish (9-1)", code: "7160" },
  { name: "Statistics", code: "0479" },
  { name: "Swahili", code: "0262" },
  { name: "Thai - First Language", code: "0518" },
  { name: "Travel & Tourism", code: "0471" },
  { name: "Turkish - First Language", code: "0513" },
  { name: "Urdu as a Second Language", code: "0539" },
  { name: "Vietnamese - First Language", code: "0695" },
  { name: "World Literature", code: "0408" },
];

const state = {
  user: null,
  igcse: [],
  activeFilter: "all",
  role: "guest",
  stats: {
    points: 0,
    streak: 0,
    skills: 0,
    completion: 0,
  },
};

const elements = {
  questGrid: document.getElementById("questGrid"),
  aiLog: document.getElementById("aiLog"),
  levelBar: document.getElementById("levelBar"),
  sponsorList: document.getElementById("sponsorList"),
  timeline: document.getElementById("timeline"),
  aboutContent: document.getElementById("aboutContent"),
  aboutEditor: document.getElementById("aboutEditor"),
  aboutModal: document.getElementById("aboutModal"),
  statsModal: document.getElementById("statsModal"),
  toast: document.getElementById("toast"),
  igcseList: document.getElementById("igcseList"),
  igcseDetail: document.getElementById("igcseDetail"),
  igcseSearch: document.getElementById("igcseSearch"),
  igcseFilter: document.getElementById("igcseFilter"),
  ibList: document.getElementById("ibList"),
  ibDetail: document.getElementById("ibDetail"),
  ibSearch: document.getElementById("ibSearch"),
  signedInAs: document.getElementById("signedInAs"),
  filePreview: document.getElementById("filePreview"),
  fileMeta: document.getElementById("fileMeta"),
  appleStatus: document.getElementById("appleStatus"),
  questModal: document.getElementById("questModal"),
  questTitle: document.getElementById("questTitle"),
  questDetail: document.getElementById("questDetail"),
  heroName: document.getElementById("heroName"),
  heroLevel: document.getElementById("heroLevel"),
  statPoints: document.getElementById("statPoints"),
  statStreak: document.getElementById("statStreak"),
  statSkills: document.getElementById("statSkills"),
  statCompletion: document.getElementById("statCompletion"),
  statAvgStreak: document.getElementById("statAvgStreak"),
  statTotalPoints: document.getElementById("statTotalPoints"),
  statSponsorSkills: document.getElementById("statSponsorSkills"),
  modalCompletion: document.getElementById("modalCompletion"),
  modalStreak: document.getElementById("modalStreak"),
  modalSkills: document.getElementById("modalSkills"),
  profileAvatar: document.getElementById("profileAvatar"),
  profileName: document.getElementById("profileName"),
  profileEmail: document.getElementById("profileEmail"),
  accountDisplayName: document.getElementById("accountDisplayName"),
  accountEmail: document.getElementById("accountEmail"),
  profilePhotoInput: document.getElementById("profilePhotoInput"),
  adminRequestsList: document.getElementById("adminRequestsList"),
  requestAdminStatus: document.getElementById("requestAdminStatus"),
  languageSelect: document.getElementById("languageSelect"),
  adminMembersList: document.getElementById("adminMembersList"),
};

const showToast = (message) => {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  setTimeout(() => elements.toast.classList.remove("is-visible"), 1800);
};

const applyLanguage = (langCode) => {
  const pack = i18n[langCode] || i18n.en;
  const t = (key) => pack[key] || i18n.en[key] || key;

  const navMap = {
    home: "navHome",
    quests: "navQuests",
    verify: "navVerify",
    igcse: "navIgcse",
    ib: "navIb",
    stats: "navStats",
    about: "navAbout",
    contact: "navContact",
    account: "navAccount",
  };
  Object.entries(navMap).forEach(([page, key]) => {
    const el = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (el) el.textContent = t(key);
  });

  document.querySelectorAll("[data-action='start-quest']").forEach((el) => {
    el.textContent = t("startQuest");
  });
  document.querySelectorAll("[data-action='go-verify']").forEach((el) => {
    el.textContent = t("verifyHomework");
  });
  const viewStatsBtn = document.querySelector("[data-action='open-stats']");
  if (viewStatsBtn) viewStatsBtn.textContent = t("viewStats");

  const heroPill = document.querySelector("#home .hero-copy .pill");
  const heroTitle = document.querySelector("#home .hero-copy h1");
  const heroBody = document.querySelector("#home .hero-copy p");
  if (heroPill) heroPill.textContent = t("heroPill");
  if (heroTitle) heroTitle.textContent = t("heroTitle");
  if (heroBody) heroBody.textContent = t("heroBody");

  const settingsTitle = document.getElementById("settingsTitle");
  const settingsThemeLabel = document.getElementById("settingsThemeLabel");
  const settingsLanguageLabel = document.getElementById("settingsLanguageLabel");
  const compactModeLabel = document.getElementById("compactModeLabel");
  const closeSettings = document.getElementById("closeSettings");
  const themeDarkLabel = document.getElementById("themeDarkLabel");
  const themeLightLabel = document.getElementById("themeLightLabel");
  const themeRedLabel = document.getElementById("themeRedLabel");
  const themePurpleLabel = document.getElementById("themePurpleLabel");
  if (settingsTitle) settingsTitle.textContent = t("settingsTitle");
  if (settingsThemeLabel) settingsThemeLabel.textContent = t("settingsTheme");
  if (settingsLanguageLabel) settingsLanguageLabel.textContent = t("settingsLanguage");
  if (compactModeLabel) compactModeLabel.textContent = t("settingsCompact");
  if (closeSettings) closeSettings.textContent = t("settingsClose");
  if (themeDarkLabel) themeDarkLabel.textContent = t("themeDark");
  if (themeLightLabel) themeLightLabel.textContent = t("themeLight");
  if (themeRedLabel) themeRedLabel.textContent = t("themeRed");
  if (themePurpleLabel) themePurpleLabel.textContent = t("themePurple");
};

const setPage = (pageId) => {
  const allowedWhenLoggedOut = new Set(["home", "about", "account"]);
  if (!state.user && !allowedWhenLoggedOut.has(pageId)) {
    showToast("Please sign in to access this page.");
    pageId = "account";
  }
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("is-active", page.id === pageId);
  });
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === pageId);
  });
};

const loadAbout = async () => {
  const saved = localStorage.getItem("guild.about") || defaultAbout;
  elements.aboutContent.textContent = saved;
  elements.aboutEditor.value = saved;
};

const saveAbout = async () => {
  const value = elements.aboutEditor.value.trim();
  if (!value) return;
  localStorage.setItem("guild.about", value);
  elements.aboutContent.textContent = value;
  showToast("About content saved.");
};

const renderQuests = () => {
  elements.questGrid.innerHTML = "";
  const filtered = quests.filter((quest) =>
    state.activeFilter === "all" ? true : quest.type === state.activeFilter
  );
  filtered.forEach((quest) => {
    const card = document.createElement("div");
    card.className = "quest";
    card.innerHTML = `
      <div class="tag">${quest.type.toUpperCase()}</div>
      <h4>${quest.title}</h4>
      <p>${quest.description}</p>
      <div class="quest-footer">
        <span>+${quest.reward} pts</span>
        <button data-id="${quest.id}">Open</button>
      </div>
    `;
    elements.questGrid.appendChild(card);
  });
};

const renderSponsors = () => {
  elements.sponsorList.innerHTML = "";
  sponsors.forEach((sponsor) => {
    const card = document.createElement("div");
    card.className = "sponsor-card";
    card.innerHTML = `
      <div>
        <div>${sponsor.name}</div>
        <div class="muted">Skill: ${sponsor.skill}</div>
      </div>
      <span>+${sponsor.points} pts</span>
    `;
    elements.sponsorList.appendChild(card);
  });
};

const renderTimeline = () => {
  elements.timeline.innerHTML = "";
  timelineEntries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "timeline-item";
    item.textContent = entry;
    elements.timeline.appendChild(item);
  });
};

const addLog = (message, type = "success") => {
  elements.aiLog.innerHTML = `
    <div class="log-title">AI Verdict</div>
    <div class="log-entry ${type}">${message}</div>
  `;
};

const simulateVerification = (message = "Verified! Quest completed. +120 points") => {
  addLog("Analyzing clip...", "pending");
  elements.levelBar.style.width = "10%";
  setTimeout(() => {
    addLog(message, "success");
    state.stats.points = Number(state.stats.points || 0) + 20;
    state.stats.streak = Math.max(1, Number(state.stats.streak || 0));
    state.stats.completion = Math.min(100, Number(state.stats.completion || 0) + 5);
    saveStats();
    renderStats();
    elements.levelBar.style.width = "18%";
  }, 1200);
};

const openQuestModal = (quest) => {
  elements.questTitle.textContent = quest.title;
  const questions = quest.questions || [];
  elements.questDetail.innerHTML = `
    <div class="exercise">
      <strong>Goal</strong>
      <p class="muted">${quest.description}</p>
    </div>
    <div class="exercise">
      <strong>Exercises</strong>
      <ul>
        ${quest.exercises.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
    ${
      questions.length
        ? `<div class="exercise">
      <strong>Questions</strong>
      <ul>
        ${questions.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>`
        : ""
    }
    <div class="exercise">
      <strong>Submit Evidence</strong>
      <p class="muted">Upload a file or record video in the Verify tab.</p>
      <button class="secondary" data-action="go-verify">Go to Verify</button>
    </div>
  `;
  elements.questModal.classList.add("is-open");
  elements.questModal.setAttribute("aria-hidden", "false");
  elements.questDetail
    .querySelector("[data-action='go-verify']")
    .addEventListener("click", () => setPage("verify"));
};

const initQuestFilters = () => {
  document.querySelectorAll("#questFilters .pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document
        .querySelectorAll("#questFilters .pill")
        .forEach((p) => p.classList.remove("is-active"));
      pill.classList.add("is-active");
      state.activeFilter = pill.dataset.filter;
      renderQuests();
    });
  });

  elements.questGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const quest = quests.find((item) => item.id === Number(button.dataset.id));
    if (!quest) return;
    openQuestModal(quest);
  });
};

const mailto = (subject, body) =>
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const initContact = () => {
  document
    .querySelector("[data-action='contact-email']")
    .addEventListener("click", () => {
      window.location.href = mailto(
        "Guild inquiry",
        "Hi Guild team,%0D%0A%0D%0A"
      );
    });

  document
    .querySelector("[data-action='request-pilot']")
    .addEventListener("click", () => {
      window.location.href = mailto(
        "Guild pilot request",
        "Hi Guild team, we want to run a pilot."
      );
    });

  document.getElementById("contactForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("contactName").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const message = document.getElementById("contactMessage").value.trim();
    window.location.href = mailto(
      "Guild message",
      `Name: ${name}\nEmail: ${email}\n\n${message}`
    );
  });
};

const setUser = async (user) => {
  state.user = user;
  if (user) {
    document.body.classList.remove("logged-out");
    document.body.classList.add("logged-in");
    const adminLabel = user.email === ADMIN_EMAIL ? " (admin)" : "";
    elements.signedInAs.textContent = `${user.displayName || user.email}${adminLabel}`;
    await ensureProfile(user);
    await hydrateProfile(user.uid);
    updateProfileUI(user);
    applyStoredAvatar(user);
    loadStats();
  } else {
    document.body.classList.remove("logged-in");
    document.body.classList.add("logged-out");
    elements.signedInAs.textContent = "Not signed in";
    updateProfileUI(null);
    loadStats();
    setPage("home");
  }
  renderStats();
  toggleAdminFeatures();
  refreshOwnAdminRequestStatus();
  renderAdminMembers();
  toggleAuthCards();
  if (isSuperAdmin()) {
    loadAdminRequests();
  }
};

const updateProfileUI = (user) => {
  if (!user) {
    elements.profileName.textContent = "Guest";
    elements.profileEmail.textContent = "Not signed in";
    elements.profileAvatar.innerHTML = "G";
    if (elements.accountEmail) elements.accountEmail.value = "";
    return;
  }
  elements.profileName.textContent = user.displayName || "Learner";
  elements.profileEmail.textContent = user.email || "";
  const storedAvatar = localStorage.getItem(`guild.avatar.${user.uid}`);
  if (storedAvatar) {
    elements.profileAvatar.innerHTML = `<img src="${storedAvatar}" alt="Profile" />`;
  } else if (user.photoURL) {
    elements.profileAvatar.innerHTML = `<img src="${user.photoURL}" alt="Profile" />`;
  } else {
    const letter = (user.displayName || user.email || "G").charAt(0).toUpperCase();
    elements.profileAvatar.textContent = letter;
  }
  if (elements.accountDisplayName) {
    elements.accountDisplayName.value = user.displayName || "";
  }
  if (elements.accountEmail) elements.accountEmail.value = user.email || "";
};

const statsKey = () => (state.user ? `guild.stats.${state.user.uid}` : "guild.stats.guest");

const loadStats = () => {
  const saved = localStorage.getItem(statsKey());
  if (saved) {
    try {
      state.stats = JSON.parse(saved);
      return;
    } catch (error) {
      // fall through
    }
  }
  state.stats = { points: 0, streak: 0, skills: 0, completion: 0 };
  localStorage.setItem(statsKey(), JSON.stringify(state.stats));
};

const saveStats = () => {
  localStorage.setItem(statsKey(), JSON.stringify(state.stats));
};

const resetAllLocalStats = () => {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("guild.stats.")) {
      localStorage.setItem(
        key,
        JSON.stringify({ points: 0, streak: 0, skills: 0, completion: 0 })
      );
    }
  });
  state.stats = { points: 0, streak: 0, skills: 0, completion: 0 };
  saveStats();
};

const renderStats = () => {
  elements.statPoints.textContent = String(state.stats.points || 0);
  elements.statStreak.textContent = String(state.stats.streak || 0);
  elements.statSkills.textContent = String(state.stats.skills || 0);
  const level = Math.max(1, Math.floor((state.stats.points || 0) / 150) + 1);
  elements.heroLevel.textContent = `Level ${level} - Starting out`;
  if (elements.statCompletion) elements.statCompletion.textContent = `${state.stats.completion || 0}%`;
  if (elements.statAvgStreak) elements.statAvgStreak.textContent = String(state.stats.streak || 0);
  if (elements.statTotalPoints) elements.statTotalPoints.textContent = String(state.stats.points || 0);
  if (elements.statSponsorSkills) elements.statSponsorSkills.textContent = String(state.stats.skills || 0);
  if (elements.modalCompletion) elements.modalCompletion.textContent = `${state.stats.completion || 0}%`;
  if (elements.modalStreak) elements.modalStreak.textContent = String(state.stats.streak || 0);
  if (elements.modalSkills) elements.modalSkills.textContent = String(state.stats.skills || 0);
};

const isSuperAdmin = () => state.user && state.user.email === ADMIN_EMAIL;
const isAdmin = () => isSuperAdmin() || state.role === "admin";

const toggleAuthCards = () => {
  const isSignedIn = !!state.user;
  const hideWhenSignedIn = [
    "signupForm",
    "signinForm",
    "googleSignIn",
    "appleButton",
    "appleStatus",
    "saveAppleConfig",
    "appleServiceId",
    "appleRedirect",
  ];
  hideWhenSignedIn.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.closest(".panel-card").style.display = isSignedIn ? "none" : "block";
  });
  document.getElementById("signOutTop").style.display = isSignedIn ? "inline-flex" : "none";

  // Hide restricted navigation when logged out
  const restrictedPages = new Set(["quests", "verify", "igcse", "ib", "stats", "contact"]);
  document.querySelectorAll(".nav-link").forEach((link) => {
    const page = link.dataset.page;
    if (restrictedPages.has(page)) {
      link.style.display = isSignedIn ? "inline-flex" : "none";
    }
  });
};

const toggleAdminFeatures = () => {
  const canEdit = isAdmin();
  document.getElementById("editAbout").style.display = canEdit
    ? "inline-flex"
    : "none";
  document.getElementById("adminAiCard").style.display = canEdit
    ? "block"
    : "none";
  document.getElementById("adminRequestsCard").style.display = isSuperAdmin()
    ? "block"
    : "none";
  const adminMembersCard = document.getElementById("adminMembersCard");
  if (adminMembersCard) adminMembersCard.style.display = isAdmin() ? "block" : "none";
  const settingsAdminWidget = document.getElementById("settingsAdminWidget");
  if (settingsAdminWidget) settingsAdminWidget.style.display = isAdmin() ? "grid" : "none";
  const selfRequestCard = document.getElementById("adminRequestSelfCard");
  if (selfRequestCard) {
    selfRequestCard.style.display = state.user && !isAdmin() ? "block" : "none";
  }
};

const saveUserProfile = async (user, prefs = {}) => {
  if (!user) return;
  await setDoc(
    doc(db, "profiles", user.uid),
    {
      displayName: user.displayName || user.email,
      email: user.email,
      prefs,
      role: prefs.role || "user",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

const ensureProfile = async (user) => {
  const snap = await getDoc(doc(db, "profiles", user.uid));
  if (snap.exists()) return;
  await setDoc(doc(db, "profiles", user.uid), {
    displayName: user.displayName || user.email,
    email: user.email,
    role: "user",
    createdAt: serverTimestamp(),
  });
};

const hydrateProfile = async (uid) => {
  const snap = await getDoc(doc(db, "profiles", uid));
  if (!snap.exists()) return;
  const data = snap.data();
  state.role = data.role || "user";
  const prefs = data.prefs || {};
  const prefDisplayName = document.getElementById("prefDisplayName");
  const prefGoal = document.getElementById("prefGoal");
  const prefSponsor = document.getElementById("prefSponsor");
  const prefNotifications = document.getElementById("prefNotifications");
  if (prefs.displayName) prefDisplayName.value = prefs.displayName;
  if (prefs.goal) prefGoal.value = prefs.goal;
  if (typeof prefs.sponsor === "boolean") prefSponsor.checked = prefs.sponsor;
  if (typeof prefs.notifications === "boolean")
    prefNotifications.checked = prefs.notifications;

  elements.heroName.textContent = prefs.displayName || data.displayName || "Learner";
};

const initSignup = () => {
  document.getElementById("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value.trim();
    const accountType = document.querySelector("input[name='accountType']:checked")?.value;
    if (!name || !email || !password) return;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      if (accountType === "admin_request") {
        await saveUserProfile(cred.user, { displayName: name, role: "pending_admin" });
        await createAdminRequest(cred.user);
        showToast("Admin request submitted (24h expiry).");
      } else {
        await saveUserProfile(cred.user, { displayName: name, role: "user" });
        showToast("Account created.");
      }
    } catch (error) {
      showToast(error.message || "Sign-up failed.");
    }
  });

  document.getElementById("signinForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("signinEmail").value.trim();
    const password = document.getElementById("signinPassword").value.trim();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Signed in.");
    } catch (error) {
      showToast(error.message || "Sign-in failed.");
    }
  });

  document.getElementById("signOut").addEventListener("click", async () => {
    await firebaseSignOut(auth);
    showToast("Signed out.");
  });
  document.getElementById("signOutTop").addEventListener("click", async () => {
    await firebaseSignOut(auth);
    showToast("Signed out.");
  });
};

const initPasswordToggles = () => {
  const toggle = (inputId, buttonId) => {
    const input = document.getElementById(inputId);
    const button = document.getElementById(buttonId);
    button.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.textContent = isHidden ? "Hide" : "Show";
    });
  };
  toggle("signupPassword", "toggleSignupPassword");
  toggle("signinPassword", "toggleSigninPassword");
  toggle("accountPassword", "toggleAccountPassword");
};

const initPreferences = () => {
  const prefsForm = document.getElementById("prefsForm");
  const prefDisplayName = document.getElementById("prefDisplayName");
  const prefGoal = document.getElementById("prefGoal");
  const prefSponsor = document.getElementById("prefSponsor");
  const prefNotifications = document.getElementById("prefNotifications");

  prefsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const prefs = {
      displayName: prefDisplayName.value.trim(),
      goal: prefGoal.value.trim(),
      sponsor: prefSponsor.checked,
      notifications: prefNotifications.checked,
    };
    if (state.user) {
      await saveUserProfile(state.user, prefs);
    }
    localStorage.setItem("guild.prefs", JSON.stringify(prefs));
    elements.heroName.textContent = prefs.displayName || elements.heroName.textContent;
    showToast("Preferences saved.");
  });
};

const initAccountSettings = () => {
  const form = document.getElementById("accountForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) {
      showToast("Sign in to update account.");
      return;
    }
    const displayName = elements.accountDisplayName.value.trim();
    const newPassword = document.getElementById("accountPassword").value.trim();
    try {
      if (displayName && displayName !== state.user.displayName) {
        await updateProfile(state.user, { displayName });
      }
      if (newPassword.length >= 6) {
        await updatePassword(state.user, newPassword);
        document.getElementById("accountPassword").value = "";
      }
      showToast("Account updated.");
      updateProfileUI(state.user);
    } catch (error) {
      showToast(error.message || "Account update failed.");
    }
  });
};

const createAdminRequest = async (user) => {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  await setDoc(doc(db, "admin_requests", user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email,
    status: "pending",
    createdAt: serverTimestamp(),
    expiresAt,
  });
};

const loadAdminRequests = async () => {
  if (!isSuperAdmin()) return;
  elements.adminRequestsList.innerHTML = "";
  const now = Date.now();
  const q = query(
    collection(db, "admin_requests"),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    elements.adminRequestsList.innerHTML = "<div class=\"muted\">No pending requests.</div>";
    return;
  }
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const expired = data.expiresAt && data.expiresAt < now;
    const card = document.createElement("div");
    card.className = "request-card";
    card.innerHTML = `
      <div><strong>${data.displayName}</strong></div>
      <div class="muted">${data.email}</div>
      <div class="muted">${expired ? "Expired" : "Pending"} - Expires in ${Math.max(0, Math.ceil((data.expiresAt - now) / 3600000))}h</div>
      <div class="request-actions">
        <button class="secondary" data-action="approve" data-uid="${data.uid}" ${expired ? "disabled" : ""}>Approve</button>
        <button class="ghost" data-action="deny" data-uid="${data.uid}">Deny</button>
      </div>
    `;
    elements.adminRequestsList.appendChild(card);
  });
};

const renderAdminMembers = () => {
  const listEl = elements.adminMembersList;
  if (!listEl) return;
  if (!isAdmin()) {
    listEl.innerHTML = "<div class=\"muted\">Admin only.</div>";
    return;
  }
  const users = loadUsers().sort((a, b) =>
    (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "")
  );
  const countEl = document.getElementById("settingsMemberCount");
  if (countEl) countEl.textContent = `Members: ${users.length}`;
  if (!users.length) {
    listEl.innerHTML = "<div class=\"muted\">No members yet.</div>";
    return;
  }
  listEl.innerHTML = users
    .map((u) => {
      const isCurrent = state.user && state.user.uid === u.uid;
      return `
        <div class="request-card">
          <div><strong>${u.displayName || "Learner"}</strong>${isCurrent ? " (you)" : ""}</div>
          <div class="muted">${u.email || "No email"}</div>
        </div>
      `;
    })
    .join("");
};

const refreshOwnAdminRequestStatus = async () => {
  const statusEl = elements.requestAdminStatus;
  if (!statusEl) return;
  if (!state.user) {
    statusEl.textContent = "Sign in to request access.";
    return;
  }
  if (isAdmin()) {
    statusEl.textContent = "You already have admin access.";
    return;
  }
  const snap = await getDoc(doc(db, "admin_requests", state.user.uid));
  if (!snap.exists()) {
    statusEl.textContent = "No request submitted yet.";
    return;
  }
  const data = snap.data();
  const now = Date.now();
  if (data.status === "approved") {
    statusEl.textContent = "Approved. Sign out and sign in again to refresh role.";
    return;
  }
  if (data.status === "denied") {
    statusEl.textContent = "Your last request was denied.";
    return;
  }
  const expired = data.expiresAt && data.expiresAt < now;
  if (expired) {
    statusEl.textContent = "Previous request expired. You can submit a new one.";
    return;
  }
  const hoursLeft = Math.max(0, Math.ceil((data.expiresAt - now) / 3600000));
  statusEl.textContent = `Pending admin approval (${hoursLeft}h left).`;
};

const handleAdminRequestAction = async (action, uid) => {
  if (!isSuperAdmin()) return;
  if (action === "approve") {
    await updateDoc(doc(db, "profiles", uid), { role: "admin" });
    await updateDoc(doc(db, "admin_requests", uid), { status: "approved" });
    showToast("Admin approved.");
  } else if (action === "deny") {
    await updateDoc(doc(db, "profiles", uid), { role: "user" });
    await updateDoc(doc(db, "admin_requests", uid), { status: "denied" });
    showToast("Admin denied.");
  }
  loadAdminRequests();
};

const initAdminRequests = () => {
  document.getElementById("refreshAdminRequests").addEventListener("click", loadAdminRequests);
  elements.adminRequestsList.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    handleAdminRequestAction(button.dataset.action, button.dataset.uid);
  });
};

const initSelfAdminRequest = () => {
  const button = document.getElementById("requestAdminAccess");
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!state.user) {
      showToast("Sign in first.");
      return;
    }
    if (isAdmin()) {
      showToast("You already have admin access.");
      return;
    }
    const existing = await getDoc(doc(db, "admin_requests", state.user.uid));
    if (existing.exists()) {
      const data = existing.data();
      const now = Date.now();
      if (data.status === "pending" && data.expiresAt > now) {
        showToast("Request already pending.");
        await refreshOwnAdminRequestStatus();
        return;
      }
    }
    await createAdminRequest(state.user);
    await saveUserProfile(state.user, { role: "pending_admin" });
    showToast("Admin request submitted.");
    await refreshOwnAdminRequestStatus();
  });
};

const initAdminMembers = () => {
  const refreshButton = document.getElementById("refreshMembers");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      renderAdminMembers();
      showToast("Members refreshed.");
    });
  }
  const openButton = document.getElementById("openMembersManager");
  if (openButton) {
    openButton.addEventListener("click", () => {
      setPage("account");
      const sidebar = document.getElementById("settingsSidebar");
      if (sidebar) {
        sidebar.classList.remove("is-open");
        sidebar.setAttribute("aria-hidden", "true");
      }
      const target = document.getElementById("adminMembersCard");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      renderAdminMembers();
    });
  }
};

const initAiRoutingToggle = () => {
  const toggle = document.getElementById("aiRouteToggle");
  if (!toggle) return;
  const stored = localStorage.getItem("guild.aiRoute");
  if (stored === "local") toggle.checked = true;
  toggle.addEventListener("change", () => {
    if (!state.user || state.user.email !== ADMIN_EMAIL) return;
    localStorage.setItem("guild.aiRoute", toggle.checked ? "local" : "remote");
    showToast(`AI route set to ${toggle.checked ? "local" : "remote"}.`);
  });
};

const initGoogleSignIn = () => {
  document.getElementById("googleSignIn").addEventListener("click", async () => {
    try {
      await signInWithPopup(auth);
      showToast("Google sign-in successful.");
    } catch (error) {
      showToast(error.message || "Google sign-in failed.");
    }
  });
};

const initAppleSignIn = () => {
  const serviceInput = document.getElementById("appleServiceId");
  const redirectInput = document.getElementById("appleRedirect");
  const saveBtn = document.getElementById("saveAppleConfig");
  const appleButton = document.getElementById("appleButton");

  const saved = JSON.parse(localStorage.getItem("guild.apple") || "{}");
  if (saved.serviceId) serviceInput.value = saved.serviceId;
  if (saved.redirect) redirectInput.value = saved.redirect;

  const updateStatus = () => {
    const ready = serviceInput.value.trim() && redirectInput.value.trim();
    elements.appleStatus.textContent = ready
      ? "Configured (backend required)"
      : "Not configured";
  };

  saveBtn.addEventListener("click", () => {
    const serviceId = serviceInput.value.trim();
    const redirect = redirectInput.value.trim();
    if (!serviceId || !redirect) {
      showToast("Add Apple Services ID and redirect URL.");
      return;
    }
    localStorage.setItem("guild.apple", JSON.stringify({ serviceId, redirect }));
    updateStatus();
    showToast("Apple config saved (backend still required).");
  });

  appleButton.addEventListener("click", () => {
    showToast("Apple sign-in needs backend token verification.");
  });

  updateStatus();
};

const initNavigation = () => {
  document.getElementById("nav").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const page = button.dataset.page;
    if (page) setPage(page);
  });

  document.querySelectorAll("[data-action='start-quest']").forEach((button) => {
    button.addEventListener("click", () => {
      setPage("quests");
      showToast("Pick a quest to start.");
    });
  });

  document.querySelectorAll("[data-action='go-verify']").forEach((button) => {
    button.addEventListener("click", () => setPage("verify"));
  });

  document
    .querySelector("[data-action='open-stats']")
    .addEventListener("click", () => {
      elements.statsModal.classList.add("is-open");
      elements.statsModal.setAttribute("aria-hidden", "false");
    });

  document.getElementById("closeStats").addEventListener("click", () => {
    elements.statsModal.classList.remove("is-open");
    elements.statsModal.setAttribute("aria-hidden", "true");
  });
};

const initStatsControls = () => {
  const refreshBtn = document.getElementById("refreshStats");
  const resetBtn = document.getElementById("resetStats");
  const resetAllBtn = document.getElementById("resetAllStats");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadStats();
      renderStats();
      showToast("Stats refreshed.");
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.stats = { points: 0, streak: 0, skills: 0, completion: 0 };
      saveStats();
      renderStats();
      showToast("Stats reset to zero.");
    });
  }
  if (resetAllBtn) {
    resetAllBtn.addEventListener("click", () => {
      resetAllLocalStats();
      renderStats();
      showToast("All local stats reset to zero.");
    });
  }
};

const initAboutModal = () => {
  document.getElementById("editAbout").addEventListener("click", () => {
    elements.aboutModal.classList.add("is-open");
    elements.aboutModal.setAttribute("aria-hidden", "false");
  });

  document.getElementById("closeAbout").addEventListener("click", () => {
    elements.aboutModal.classList.remove("is-open");
    elements.aboutModal.setAttribute("aria-hidden", "true");
  });

  document.getElementById("saveAbout").addEventListener("click", () => {
    saveAbout();
    elements.aboutModal.classList.remove("is-open");
    elements.aboutModal.setAttribute("aria-hidden", "true");
  });

  document.getElementById("closeQuest").addEventListener("click", () => {
    elements.questModal.classList.remove("is-open");
    elements.questModal.setAttribute("aria-hidden", "true");
  });
};

const initCamera = ({
  startBtn,
  recordBtn,
  stopBtn,
  videoEl,
  overlayEl,
  statusEl,
  onRecorded,
}) => {
  let stream = null;
  let recorder = null;
  let chunks = [];

  const stopStream = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    overlayEl.textContent = "Camera stopped";
  };

  startBtn.addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      videoEl.srcObject = stream;
      overlayEl.textContent = "Camera live";
      showToast("Camera ready.");
    } catch (error) {
      overlayEl.textContent = "Camera permission denied";
      showToast("Unable to access camera.");
    }
  });

  recordBtn.addEventListener("click", () => {
    if (!stream) {
      showToast("Start the camera first.");
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      if (onRecorded) onRecorded(blob);
    };
    recorder.start();
    overlayEl.textContent = "Recording...";
    if (statusEl) statusEl.textContent = "Recording in progress";
  });

  stopBtn.addEventListener("click", () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    stopStream();
    if (statusEl) statusEl.textContent = "Recording saved locally.";
  });
};

const initVerification = () => {
  initCamera({
    startBtn: document.getElementById("startCamera"),
    recordBtn: document.getElementById("recordCamera"),
    stopBtn: document.getElementById("stopCamera"),
    videoEl: document.getElementById("cameraPreview"),
    overlayEl: document.getElementById("cameraOverlay"),
    onRecorded: () => simulateVerification(),
  });

  initCamera({
    startBtn: document.getElementById("verifyStart"),
    recordBtn: document.getElementById("verifyRecord"),
    stopBtn: document.getElementById("verifyStop"),
    videoEl: document.getElementById("verifyPreview"),
    overlayEl: document.getElementById("verifyOverlay"),
    statusEl: document.getElementById("recordStatus"),
    onRecorded: () => {
      document.getElementById("recordStatus").textContent = "Recording captured. Ready for checks.";
      showToast("Recording saved.");
    },
  });

  const docInput = document.getElementById("docInput");
  const docResult = document.getElementById("docResult");
  let currentFile = null;

  docInput.addEventListener("change", (event) => {
    currentFile = event.target.files[0];
    if (!currentFile) return;
    const extension = currentFile.name.split(".").pop().toLowerCase();
    elements.fileMeta.textContent = `${currentFile.name} - ${Math.round(
      currentFile.size / 1024
    )} KB`;
    elements.filePreview.innerHTML = "";
    if (["png", "jpg", "jpeg", "webp", "heic"].includes(extension)) {
      const img = document.createElement("img");
      img.alt = "Uploaded evidence";
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.readAsDataURL(currentFile);
      elements.filePreview.appendChild(img);
    } else if (["mp4", "mov"].includes(extension)) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = URL.createObjectURL(currentFile);
      elements.filePreview.appendChild(video);
    } else {
      elements.filePreview.innerHTML =
        "<div class=\"preview-placeholder\">Document uploaded</div>";
    }
    docResult.innerHTML = `
      <div class="log-title">Check Summary</div>
      <div class="log-entry pending">${currentFile.name} loaded. Ready to analyze.</div>
    `;
  });

  document.getElementById("runChecks").addEventListener("click", async () => {
    if (!currentFile) {
      showToast("Upload a document first.");
      return;
    }
    const extension = currentFile.name.split(".").pop().toLowerCase();
    let textSample = "";
    if (["txt", "md", "csv", "json"].includes(extension)) {
      textSample = await currentFile.text();
    }
    const sizeKb = Math.round(currentFile.size / 1024);
    const aiRisk = estimateAiRisk(textSample, sizeKb);
    let aiVerdict = "Local heuristic verdict ready.";
    let usedFallback = false;
    try {
      const endpoint = getAiEndpoint();
      if (!endpoint) {
        usedFallback = true;
      } else if (endpoint.includes("localhost")) {
        const formData = new FormData();
        formData.append("file", currentFile);
        formData.append("subject", "Homework");
        formData.append("notes", `File: ${currentFile.name}`);
        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });
        if (response.ok) {
          const data = await response.json();
          aiVerdict = data.verdict || aiVerdict;
        } else {
          usedFallback = true;
        }
      } else {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textSample,
            evidenceUrl: "",
            subject: "Homework",
            notes: `File: ${currentFile.name}`,
            fileName: currentFile.name,
            fileType: currentFile.type || "",
          }),
        });
        if (response.ok) {
          const data = await response.json();
          aiVerdict = data.verdict || aiVerdict;
        } else {
          usedFallback = true;
        }
      }
    } catch (error) {
      usedFallback = true;
    }

    if (usedFallback) {
      aiVerdict = buildFallbackVerdict({
        extension,
        sizeKb,
        aiRisk,
        hasText: Boolean(textSample.trim()),
      });
    }

    docResult.innerHTML = `
      <div class="log-title">Check Summary</div>
      <div class="log-entry success">File type: .${extension} - ${sizeKb} KB</div>
      <div class="log-entry ${aiRisk.level}">Anti-AI score: ${aiRisk.label}</div>
      <div class="log-entry pending">Originality scan: ${aiRisk.originality}</div>
      <div class="log-entry ${usedFallback ? "pending" : "success"}">AI verdict: ${aiVerdict}</div>
    `;
    if (["png", "jpg", "jpeg", "webp", "heic", "mp4", "mov"].includes(extension)) {
      simulateVerification("Visual evidence captured. +80 points");
    }
    showToast(usedFallback ? "Checks complete (local fallback)." : "Checks complete.");
  });
};

const buildFallbackVerdict = ({ extension, sizeKb, aiRisk, hasText }) => {
  if (["jpg", "jpeg", "png", "webp", "heic", "mp4", "mov", "webm"].includes(extension)) {
    return "Evidence format accepted. Visual/manual review recommended, authenticity plausible.";
  }
  if (["docx", "doc", "pdf", "ppt", "pptx"].includes(extension)) {
    const sizeNote = sizeKb < 10 ? "very short submission" : "normal-length submission";
    return `Document accepted (${sizeNote}). Backend AI unavailable, so this is a provisional review only.`;
  }
  if (hasText) {
    return aiRisk.label === "High"
      ? "Text pattern suggests possible AI assistance. Needs teacher review."
      : "Text pattern appears mostly natural. Recommend normal review.";
  }
  return "File accepted. Backend AI unavailable, fallback review applied.";
};

const estimateAiRisk = (text, sizeKb) => {
  if (!text) {
    return {
      label: "Unknown (non-text file)",
      level: "pending",
      originality: "Manual review required",
    };
  }
  const words = text.split(/\s+/).filter(Boolean);
  const unique = new Set(words.map((w) => w.toLowerCase()));
  const diversity = unique.size / Math.max(words.length, 1);
  const repeated = words.length - unique.size;
  let label = "Low";
  let level = "success";
  if (diversity < 0.4 || repeated > words.length * 0.45 || sizeKb < 2) {
    label = "Medium";
    level = "pending";
  }
  if (diversity < 0.3 || repeated > words.length * 0.6) {
    label = "High";
    level = "fail";
  }
  return {
    label,
    level,
    originality: diversity > 0.45 ? "Likely original" : "Needs deeper check",
  };
};

const classifyGroup = (name) => {
  const lower = name.toLowerCase();
  if (/(math|statistics)/.test(lower)) return "math";
  if (/(biology|chemistry|physics|science|environmental|marine)/.test(lower)) return "sciences";
  if (/(english|literature)/.test(lower)) return "english";
  if (/(language|french|german|arabic|spanish|italian|urdu|hindi|japanese|chinese|vietnamese|malay|thai|turkish|swahili|sanskrit|afrikaans|portuguese|latin|setswana|isizulu)/.test(lower))
    return "languages";
  if (/(history|geography|religious|sociology|global|pakistan|psychology|enterprise|economics|business|commerce)/.test(lower))
    return "humanities";
  return "creative";
};

const getSubjectQuestions = (subject) => {
  const lower = subject.toLowerCase();
  const specific = {
    "mathematics": [
      "Expand and simplify: 3(2x - 5) + 4x.",
      "Factorize fully: x^2 - 9.",
      "Solve for x: 5x - 7 = 18.",
      "For y = 2x + 3, compute y when x = -2, 0, and 4, then plot the line.",
      "Solve simultaneous equations: 2x + y = 11 and x - y = 1.",
      "Find the nth term of the sequence: 5, 8, 11, 14, ...",
      "Rearrange the formula A = (1/2)bh to make h the subject.",
      "Calculate the area and circumference of a circle with radius 7 cm (use pi = 22/7).",
      "A bag has 5 red, 3 blue, 2 green counters. Find P(blue) and P(not green).",
      "Find the gradient between points (-3, 2) and (5, 10).",
      "Construct and solve an inequality from: 'twice a number minus 4 is at least 10'.",
      "Complete the table of values for y = x^2 - 2x - 3 for x = -1, 0, 1, 2, 3.",
    ],
    "mathematics - additional": [
      "Differentiate: y = 3x^2 - 4x + 1.",
      "Solve: x^2 - 5x + 6 = 0.",
      "Find the gradient of the line through (2,3) and (6,11).",
      "Simplify: (2x^3 y^2) / (4x y).",
      "Solve: 2sin(x) = 1 for 0 deg <= x <= 360 deg.",
      "Evaluate log10(1000) and solve log2(x) = 5.",
      "Find the equation of the tangent to y = x^2 at x = 3.",
      "Integrate: integral(4x - 7) dx.",
      "Use the quadratic formula to solve 3x^2 - 7x - 6 = 0.",
      "Prove whether triangle sides 7, 24, 25 form a right triangle.",
      "Find the midpoint and distance between A(-4, 5) and B(8, -1).",
      "A function is f(x) = 2x^2 - 3x + 1. Find f(4) and solve f(x) = 1.",
    ],
    "physics": [
      "State the equation for speed.",
      "Calculate speed: 120 m in 30 s.",
      "Define momentum and give units.",
      "Describe one example of energy transfer.",
      "A car accelerates from 0 to 20 m/s in 5 s. Calculate acceleration.",
      "Calculate the resultant force when mass is 4 kg and acceleration is 3 m/s^2.",
      "State the law of conservation of energy with one example.",
      "A wave has frequency 50 Hz and wavelength 0.2 m. Find wave speed.",
      "Explain the difference between series and parallel circuits.",
      "Calculate electrical power when V = 12 V and I = 2 A.",
      "Describe one method to reduce heat loss from a house.",
      "Explain why pressure increases with depth in a liquid.",
    ],
    "chemistry": [
      "Define atom, element, and compound.",
      "Balance: H2 + O2 -> H2O.",
      "State two properties of acids.",
      "Explain the difference between ionic and covalent bonding.",
      "Write the ionic equation for neutralization between HCl and NaOH.",
      "Calculate relative formula mass of CaCO3.",
      "Describe a test for hydrogen, oxygen, and carbon dioxide gases.",
      "Explain exothermic vs endothermic reaction with one example each.",
      "A solution has pH 3. Is it acidic or alkaline? Explain.",
      "Calculate concentration: 5 g solute in 250 cm^3 solution (g/dm^3).",
      "State two factors that increase the rate of reaction.",
      "Describe the process of electrolysis of molten lead bromide.",
    ],
    "biology": [
      "Define the term: cell.",
      "Name two differences between plant and animal cells.",
      "Explain why enzymes are important in digestion.",
      "Describe one human impact on an ecosystem.",
      "Define diffusion and osmosis with one example each.",
      "State the function of nucleus, mitochondria, and chloroplast.",
      "Explain why large organisms need transport systems.",
      "Describe the role of xylem and phloem in plants.",
      "Explain how insulin controls blood glucose concentration.",
      "Outline the process of photosynthesis and give the word equation.",
      "State one adaptation of red blood cells for oxygen transport.",
      "Describe one food chain and identify producer/consumer/decomposer.",
    ],
    "computer science": [
      "Define algorithm and give an example.",
      "Write a simple if/else in pseudocode.",
      "Explain the difference between RAM and storage.",
      "Define binary and give one use case.",
      "Convert decimal 45 to binary.",
      "Convert binary 101101 to decimal.",
      "Explain linear search and binary search with one advantage each.",
      "Write pseudocode for a loop that sums numbers from 1 to 20.",
      "Describe the difference between compiler and interpreter.",
      "State two cybersecurity threats and one mitigation each.",
      "Design a simple flowchart for user login validation.",
      "Explain what a stack data structure is and one real use.",
    ],
    "information and communication technology": [
      "Name two types of networks.",
      "Explain what a database is used for.",
      "Describe two ways to keep data secure.",
      "Define input, process, output with an example.",
      "Explain LAN vs WAN with one real-world example.",
      "State two advantages of cloud storage and one risk.",
      "Write a sample database field list for a school attendance table.",
      "Explain primary key and foreign key with examples.",
      "Describe two spreadsheet formulas and what they do.",
      "Give one scenario where a mail merge is useful.",
      "Explain phishing and two warning signs.",
      "Describe two accessibility features in productivity software.",
    ],
    "english - first language": [
      "Write a 250-word essay on ambition in Shakespeare's Hamlet.",
      "Compare Hamlet and Claudius in one developed paragraph with one quote.",
      "Identify and explain two examples of imagery from a given extract.",
      "Write an introduction and thesis statement for a literary analysis essay.",
      "Write a PEEL paragraph on how conflict drives the plot in Hamlet.",
      "Analyze the effect of one soliloquy from Act 1 or Act 3.",
      "Write a persuasive speech opening on the value of reading literature.",
      "Edit a short paragraph to improve tone, grammar, and cohesion.",
      "Plan a response to: 'To what extent is Hamlet responsible for the tragedy?'",
      "Summarize a 300-word passage in no more than 80 words.",
      "Explain the connotations of three powerful words from a sample text.",
      "Write two balanced arguments on whether technology helps learning.",
    ],
    "english - literature in english": [
      "Write a 300-word response: Is Hamlet a tragic hero? Use at least one quotation.",
      "Analyze how Shakespeare presents indecision in Hamlet, Act 3.",
      "Describe tone shift in a selected passage and explain its effect.",
      "Write a PEEL paragraph on one conflict in the text.",
      "Compare how two characters respond to power and authority.",
      "Analyze one symbol and track its change across the play.",
      "Write a mini-essay on dramatic irony in one scene.",
      "Explain how stage directions influence audience interpretation.",
      "Select one quote and analyze language, structure, and effect.",
      "Write an exam-style conclusion that directly answers the prompt.",
      "Create a revision mind map for five major themes.",
      "Evaluate one critic's interpretation and respond with evidence.",
    ],
    "business studies": [
      "Define revenue, cost, and profit.",
      "Explain one reason for a business to expand.",
      "List two internal sources of finance.",
      "Give one example of a business stakeholder.",
      "Calculate gross profit and margin from given figures.",
      "Explain one advantage and one disadvantage of sole proprietorship.",
      "Describe two methods of market research.",
      "State one reason businesses segment markets.",
      "Compare batch production and flow production.",
      "Define break-even and explain why it matters.",
      "Explain one internal and one external communication method.",
      "Evaluate whether a business should outsource customer support.",
    ],
    "economics": [
      "Define supply and demand.",
      "Explain one factor that shifts demand.",
      "Calculate simple profit: revenue - cost.",
      "Give one example of a fixed cost and a variable cost.",
      "Draw a demand curve and explain movement vs shift.",
      "Define opportunity cost with a real example.",
      "Explain inflation and one likely cause.",
      "State two functions of money.",
      "Define price elasticity of demand and interpret PED = -1.8.",
      "Explain one advantage and one disadvantage of minimum wage.",
      "Distinguish between fiscal policy and monetary policy.",
      "Evaluate one policy to reduce unemployment.",
    ],
    "geography": [
      "Define physical and human geography.",
      "Explain one cause of a river flood.",
      "Describe how to read a contour map.",
      "Give one example of an urban land use.",
      "Describe two push and two pull factors of migration.",
      "Explain one impact of rapid urbanization.",
      "Interpret a climate graph and identify wettest and driest months.",
      "State two causes and two impacts of deforestation.",
      "Explain plate boundary type for one major earthquake zone.",
      "Describe coastal erosion processes: hydraulic action and abrasion.",
      "Use a six-figure grid reference for a point on a map.",
      "Evaluate one strategy for sustainable city planning.",
    ],
    "history": [
      "Summarize a key event in three bullet points.",
      "Explain one cause and one effect of the event.",
      "Define two key terms from the topic.",
      "Create a simple timeline with three events.",
      "Write a source evaluation using origin, purpose, value, limitation.",
      "Explain one long-term and one short-term cause of a conflict.",
      "Compare two interpretations of the same historical event.",
      "Answer: 'How far do you agree?' using two arguments and evidence.",
      "Describe one consequence of a treaty or policy decision.",
      "Construct a timeline with five events and brief significance notes.",
      "Explain change and continuity over a 20-year period.",
      "Write a mini-conclusion that directly addresses causation.",
    ],
  };

  if (specific[lower]) return specific[lower];

  if (/(math|statistics)/.test(lower)) {
    return [
      `Simplify: 2(3x - 5) + 4x in ${subject}.`,
      `Factorize: x^2 + 7x + 12 for ${subject}.`,
      `Solve for x: 3x - 4 = 11 in ${subject}.`,
      `Plot y = -x + 4 and find the y-value when x = 3 in ${subject}.`,
      `Solve simultaneous equations in ${subject}: x + 2y = 11 and 3x - y = 7.`,
      `Find the nth term of a sequence in ${subject}: 4, 9, 14, 19, ...`,
      `Rearrange a formula in ${subject} to make a chosen variable the subject.`,
      `Find gradient and y-intercept of y = 5x - 12 in ${subject}.`,
      `Interpret a probability tree with two-stage events in ${subject}.`,
      `Solve and graph inequality: 2x - 5 <= 9 in ${subject}.`,
      `Calculate area and perimeter of a compound shape in ${subject}.`,
      `Estimate and check reasonableness of a multi-step calculation in ${subject}.`,
    ];
  }
  if (/(biology|science|environmental|marine)/.test(lower)) {
    return [
      `Define a key term in ${subject}.`,
      `Name two differences between related concepts in ${subject}.`,
      `Explain why a process is important in ${subject}.`,
      `Describe one human impact related to ${subject}.`,
      `Describe one food web and identify trophic levels in ${subject}.`,
      `Explain one adaptation that improves survival in ${subject}.`,
      `Interpret a simple experimental graph in ${subject}.`,
      `Write a hypothesis and identify variables for a ${subject} experiment.`,
      `Explain diffusion or transport in context of ${subject}.`,
      `State one ethical issue in ${subject} and your justified view.`,
      `Describe one conservation strategy relevant to ${subject}.`,
      `Analyze data and write one evidence-based conclusion in ${subject}.`,
    ];
  }
  if (/(chemistry)/.test(lower)) {
    return [
      `Define atom, element, and compound for ${subject}.`,
      "Balance: H2 + O2 -> H2O.",
      "State two properties of acids.",
      "Explain the difference between ionic and covalent bonding.",
      `Write a word and symbol equation in ${subject}.`,
      `Calculate relative formula mass for a common compound in ${subject}.`,
      `Describe one gas test and expected observation in ${subject}.`,
      `Explain one rate-of-reaction factor in ${subject}.`,
      `Differentiate strong vs weak acid in ${subject}.`,
      `Calculate concentration from mass and volume in ${subject}.`,
      `Interpret an energy profile diagram in ${subject}.`,
      `Describe one electrolysis setup in ${subject}.`,
    ];
  }
  if (/(physics)/.test(lower)) {
    return [
      "State the equation for speed.",
      "Calculate speed: 120 m in 30 s.",
      "Define momentum.",
      "Describe one example of energy transfer.",
      `Calculate acceleration from a velocity-time scenario in ${subject}.`,
      `Use F = ma for a force calculation in ${subject}.`,
      `Explain one renewable and one non-renewable energy source in ${subject}.`,
      `Calculate wave speed from frequency and wavelength in ${subject}.`,
      `Describe current, voltage, and resistance relationship in ${subject}.`,
      `Solve a power problem using P = VI in ${subject}.`,
      `Explain pressure in liquids with depth in ${subject}.`,
      `Interpret a distance-time graph in ${subject}.`,
    ];
  }
  if (/(english|literature)/.test(lower)) {
    return [
      `Write a 250-word critical response in ${subject} with one quote.`,
      `Identify one central theme in ${subject} and explain it with evidence.`,
      `Analyze two examples of figurative language in ${subject}.`,
      `Write a clear thesis statement and supporting topic sentence for ${subject}.`,
      `Write a PEEL paragraph for a character analysis task in ${subject}.`,
      `Compare tone between two extracts in ${subject}.`,
      `Edit a short passage for clarity and grammar in ${subject}.`,
      `Write a concise summary of a passage in ${subject}.`,
      `Plan a timed response structure for ${subject}.`,
      `Analyze one quote for language and effect in ${subject}.`,
      `Write a balanced argument and counterargument in ${subject}.`,
      `Draft a strong conclusion that answers the question in ${subject}.`,
    ];
  }
  if (/(language|french|german|arabic|spanish|italian|urdu|hindi|japanese|chinese|vietnamese|malay|thai|turkish|swahili|sanskrit|afrikaans|portuguese|latin|setswana|isizulu)/.test(lower)) {
    return [
      `Translate five everyday phrases into ${subject}.`,
      `Write a short 4-sentence introduction in ${subject}.`,
      `List 10 common nouns with articles in ${subject}.`,
      `Write and read aloud a short dialog in ${subject}.`,
      `Conjugate a common verb in present tense in ${subject}.`,
      `Write five past-tense sentences in ${subject}.`,
      `Describe your daily routine in 6-8 lines in ${subject}.`,
      `Form three questions and answer them in ${subject}.`,
      `Use comparative adjectives in 4 sentences in ${subject}.`,
      `Write a polite email opening and closing in ${subject}.`,
      `Match vocabulary to definitions in ${subject}.`,
      `Correct five grammar errors in a short ${subject} paragraph.`,
    ];
  }
  if (/(history|geography|religious|sociology|global|pakistan)/.test(lower)) {
    return [
      `Summarize a key event in ${subject} in three bullet points.`,
      `Explain one cause and one effect in ${subject}.`,
      `Define two key terms from ${subject}.`,
      `Create a simple timeline with three events in ${subject}.`,
      `Evaluate one source's reliability in ${subject}.`,
      `Compare two viewpoints about the same issue in ${subject}.`,
      `Explain continuity and change in ${subject}.`,
      `Write one paragraph with evidence and explanation in ${subject}.`,
      `Describe one long-term impact in ${subject}.`,
      `Interpret a map/chart relevant to ${subject}.`,
      `Construct a balanced argument in ${subject}.`,
      `Write a short conclusion that answers the question in ${subject}.`,
    ];
  }
  if (/(economics|business|commerce|enterprise)/.test(lower)) {
    return [
      `Define supply and demand in ${subject}.`,
      `Explain one factor that shifts demand in ${subject}.`,
      "Calculate simple profit: revenue - cost.",
      "Give one example of a fixed cost and a variable cost.",
      `Define opportunity cost and apply it to a scenario in ${subject}.`,
      `Interpret a break-even chart in ${subject}.`,
      `Calculate elasticity and explain result in ${subject}.`,
      `Evaluate one pricing strategy in ${subject}.`,
      `Describe one internal and one external source of finance in ${subject}.`,
      `Analyze one policy decision effect in ${subject}.`,
      `Write a recommendation with one trade-off in ${subject}.`,
      `Differentiate between short-run and long-run decisions in ${subject}.`,
    ];
  }
  if (/(computer|ict)/.test(lower)) {
    return [
      `Define algorithm and give an example in ${subject}.`,
      "Write a simple if/else statement in pseudocode.",
      "Name two types of data storage.",
      "Explain the difference between hardware and software.",
      `Convert numbers between binary and decimal in ${subject}.`,
      `Explain linear vs binary search in ${subject}.`,
      `Write pseudocode for input validation in ${subject}.`,
      `Describe one network topology in ${subject}.`,
      `State two cybersecurity risks and mitigations in ${subject}.`,
      `Design a small table structure for ${subject} data.`,
      `Explain compiler vs interpreter in ${subject}.`,
      `Trace a loop algorithm output in ${subject}.`,
    ];
  }
  if (/(art|design|music|drama|food|nutrition|physical education)/.test(lower)) {
    return [
      `Describe the tools or materials used in ${subject}.`,
      "Create a short plan for a 30-minute practice session.",
      "Identify two techniques used to improve quality.",
      "Reflect on one thing you would change next time.",
      `Analyze one example work/performance from ${subject}.`,
      `Explain one design or performance principle in ${subject}.`,
      `Write criteria for evaluating quality in ${subject}.`,
      `Plan a mini-project timeline in ${subject}.`,
      `Describe safety considerations relevant to ${subject}.`,
      `Create a warm-up routine for ${subject}.`,
      `Identify strengths and next steps after practice in ${subject}.`,
      `Write a short artist/performer statement in ${subject}.`,
    ];
  }
  return [
    `Write a short definition of the main topic in ${subject}.`,
    `List three key terms in ${subject} and explain them briefly.`,
    `Create a 5-question quiz on ${subject}.`,
    `Summarize what you learned in ${subject} in 3 sentences.`,
    `Write one application example from real life for ${subject}.`,
    `Explain one misconception and correct it in ${subject}.`,
    `Answer one exam-style short question in ${subject}.`,
    `Create one reflection paragraph on progress in ${subject}.`,
    `Design one peer-teaching explanation for ${subject}.`,
    `Write one comparison between two related ideas in ${subject}.`,
    `Plan a 20-minute revision task for ${subject}.`,
    `State one measurable learning goal for ${subject}.`,
  ];
};

const buildIgcseCourse = (subject) => {
  return [
    {
      title: "Foundation",
      goals: [
        `Understand core ${subject} vocabulary`,
        `Practice key concepts with short tasks`,
        "Record a short reflection after each session",
      ],
    },
    {
      title: "Skills Mastery",
      goals: [
        "Complete skill drills with increasing difficulty",
        "Explain reasoning in a 2-minute video",
        "Submit notes or solutions as evidence",
      ],
    },
    {
      title: "Exam Readiness",
      goals: [
        "Attempt timed practice questions",
        "Review mistakes and annotate fixes",
        "Summarize exam strategies in your own words",
      ],
    },
  ];
};

const buildIgcseQuests = (subject) => [
  {
    title: `${subject}: Core Concepts Sprint`,
    description: "Record 20 minutes of focused notes + 12 practice questions.",
    reward: 120,
    exercises: [
      `Write a 10-term glossary for ${subject}.`,
      "Solve 12 warm-up questions.",
      "Record a 1-minute summary of what you learned.",
    ],
    questions: getSubjectQuestions(subject),
  },
  {
    title: `${subject}: Skills Checkpoint`,
    description: "Solve a short task set and explain your approach on video.",
    reward: 140,
    exercises: [
      "Complete 10 skill questions.",
      "Mark answers and highlight 2 mistakes.",
      "Explain your best strategy on video.",
    ],
    questions: getSubjectQuestions(subject).slice(0, 6),
  },
  {
    title: `${subject}: Exam Readiness Drill`,
    description: "Complete a timed practice section and reflect on improvements.",
    reward: 180,
    exercises: [
      "Attempt a 15-minute timed set.",
      "Review and correct your answers.",
      "Record a 2-minute improvement plan.",
    ],
    questions: getSubjectQuestions(subject).slice(2, 10),
  },
];

const getIbQuestions = (subject) => {
  const lower = subject.toLowerCase();
  if (lower.includes("english a")) {
    return [
      "Write a 400-word analysis of a global issue in a literary text.",
      "Compare the voice and tone of two short extracts.",
      "Draft a thesis and two body paragraph topic sentences for a Paper 1 response.",
      "Explain how structure supports meaning in one selected passage.",
      "Evaluate an author's stylistic choices and their impact on reader interpretation.",
      "Write a Paper 2 comparative paragraph with integrated evidence.",
      "Analyze one non-literary text for audience, purpose, and context.",
      "Construct a line of inquiry for an Individual Oral practice.",
      "Write a conclusion that synthesizes language and global issue.",
      "Annotate one extract and identify five key analytical observations.",
    ];
  }
  if (lower.includes("mathematics")) {
    return [
      "For y = x^2 - 4x + 3, find roots and vertex, then sketch the graph.",
      "Differentiate f(x) = 2x^3 - 5x^2 + 4 and evaluate at x = 2.",
      "Interpret a real dataset and compute mean, median, and standard deviation.",
      "Model a growth scenario with an exponential function and justify parameters.",
      "Solve a trigonometric equation in the given interval and justify solutions.",
      "Use integration to find area under a curve between two bounds.",
      "Apply binomial expansion to (1 + 2x)^5 up to x^3 term.",
      "Construct and analyze a normal distribution probability question.",
      "Use vectors to find the angle between two lines in 3D.",
      "Evaluate model limitations in one applied mathematics scenario.",
    ];
  }
  if (lower.includes("physics")) {
    return [
      "Apply SUVAT equations to solve a constant-acceleration problem.",
      "Calculate resultant force and discuss uncertainties in measurements.",
      "Explain energy conservation in a pendulum system.",
      "Design a short method to measure specific heat capacity.",
      "Use conservation of momentum in a two-body collision problem.",
      "Calculate electric field strength and interpret direction.",
      "Analyze an experimental graph to estimate gradient and uncertainty.",
      "Explain wave interference using a practical example.",
      "Compare alternating and direct current in context.",
      "Evaluate one source of systematic error in an experiment.",
    ];
  }
  if (lower.includes("chemistry")) {
    return [
      "Write and balance equations for a neutralization reaction.",
      "Explain periodic trends across a period with evidence.",
      "Calculate moles, limiting reagent, and theoretical yield for a reaction.",
      "Describe an experiment to measure reaction rate and identify controls.",
      "Explain enthalpy change using bond energies.",
      "Construct and interpret a Hess cycle.",
      "Predict products of one organic substitution reaction.",
      "Explain equilibrium shift using Le Chatelier's principle.",
      "Analyze titration data and determine unknown concentration.",
      "Evaluate reliability and validity in a practical chemistry method.",
    ];
  }
  if (lower.includes("biology")) {
    return [
      "Explain how enzymes affect reaction rates with one biological example.",
      "Analyze data from a photosynthesis experiment and draw a conclusion.",
      "Compare active transport and diffusion using cell membrane context.",
      "Describe one ethical issue in modern genetics and justify your view.",
      "Explain gene expression from DNA to protein with key steps.",
      "Interpret a pedigree chart and infer likely genotype.",
      "Evaluate one method for estimating population size in ecology.",
      "Compare immunity from vaccination and natural infection.",
      "Analyze factors affecting transpiration in plants.",
      "Design a controlled experiment for osmosis investigation.",
    ];
  }
  if (lower.includes("computer science")) {
    return [
      "Write pseudocode for a search function and analyze complexity.",
      "Explain object-oriented principles with one program example.",
      "Design a test plan for an input-validation module.",
      "Compare relational databases and NoSQL in one practical scenario.",
      "Trace an algorithm and determine Big-O complexity.",
      "Design a normalized database schema for a school system.",
      "Explain recursion with a worked factorial example.",
      "Evaluate trade-offs between arrays and linked lists.",
      "Design robust authentication flow for a web app.",
      "Write test cases covering boundary and invalid inputs.",
    ];
  }
  if (lower.includes("history")) {
    return [
      "Write a 350-word source evaluation (origin, purpose, value, limitation).",
      "Compare two historical interpretations of one event.",
      "Construct a thesis answering a 'To what extent' prompt.",
      "Use evidence to explain one long-term and one short-term cause.",
      "Write a causation paragraph with explicit judgement.",
      "Assess significance of one turning point with criteria.",
      "Synthesize evidence from two sources with provenance comments.",
      "Evaluate continuity and change over one historical period.",
      "Draft a balanced counterargument using specific evidence.",
      "Write an exam-style conclusion that revisits the thesis.",
    ];
  }
  if (lower.includes("economics")) {
    return [
      "Draw and explain a supply-demand shift for a real market.",
      "Evaluate one government intervention with stakeholders.",
      "Calculate elasticity and interpret the result.",
      "Write a short policy recommendation with one trade-off.",
      "Analyze inflation data and suggest policy response.",
      "Explain multiplier effect with a numerical example.",
      "Evaluate one market failure and corrective policy.",
      "Distinguish short-run and long-run aggregate supply effects.",
      "Calculate and interpret terms of trade change.",
      "Write a conclusion with explicit stakeholder judgement.",
    ];
  }
  return [
    `Write a structured response for ${subject} with claim, evidence, and reasoning.`,
    `Solve one applied task in ${subject} and show full method.`,
    `Critically evaluate one source or dataset used in ${subject}.`,
    `Plan a timed response strategy for an IB-style ${subject} question.`,
    `Write one argument and one counterargument for a key ${subject} issue.`,
    `Create a rubric-based self-assessment for your ${subject} answer.`,
    `Interpret one graph/table and state evidence-based conclusions in ${subject}.`,
    `Design one mini-investigation method for ${subject}.`,
    `Explain limitations of your approach in one ${subject} scenario.`,
    `Write a final exam-style judgement paragraph for a ${subject} prompt.`,
  ];
};

const buildIbCourse = (subject) => [
  {
    title: "Concept Core",
    goals: [
      `Master key terminology in ${subject}`,
      "Complete one scaffolded problem set",
      "Produce a short reflection on conceptual gaps",
    ],
  },
  {
    title: "Application",
    goals: [
      "Solve exam-style applied tasks",
      "Justify method and reasoning with evidence",
      "Submit proof artifact (notes/video/file)",
    ],
  },
  {
    title: "Assessment Prep",
    goals: [
      "Complete one timed mini-paper",
      "Self-mark against rubric",
      "Record an improvement plan",
    ],
  },
];

const buildIbQuests = (subject) => [
  {
    title: `${subject}: Concept Check`,
    description: "Answer 10 core questions and explain reasoning.",
    reward: 140,
    questions: getIbQuestions(subject),
  },
  {
    title: `${subject}: Exam Drill`,
    description: "Timed response + review with rubric.",
    reward: 180,
    questions: getIbQuestions(subject).slice(2, 10),
  },
];

const renderIgcse = () => {
  elements.igcseList.innerHTML = "";
  const search = elements.igcseSearch.value.trim().toLowerCase();
  const group = elements.igcseFilter.value;
  const filtered = state.igcse
    .filter((item) =>
      group === "all" ? true : item.group === group
    )
    .filter((item) =>
      item.name.toLowerCase().includes(search) || item.code.includes(search)
    );
  filtered.forEach((item) => {
      const button = document.createElement("button");
      button.className = "igcse-item";
      button.innerHTML = `<strong>${item.name}</strong><span class="muted">${item.code}</span>`;
      button.addEventListener("click", () => showIgcseDetail(item));
      elements.igcseList.appendChild(button);
    });
  if (filtered.length && !elements.igcseDetail.dataset.hasSelection) {
    showIgcseDetail(filtered[0]);
  }
};

const showIgcseDetail = (item) => {
  elements.igcseDetail.dataset.hasSelection = "1";
  document.querySelectorAll(".igcse-item").forEach((el) => {
    el.classList.toggle("is-active", el.textContent.includes(item.code));
  });
  const igcseQuests = buildIgcseQuests(item.name);
  const course = buildIgcseCourse(item.name);
  const previewQuestions = getSubjectQuestions(item.name);
  elements.igcseDetail.innerHTML = `
    <h3>${item.name}</h3>
    <p class="muted">Code: ${item.code}</p>
    <div class="feature-grid">
      ${course
        .map(
          (module) => `
        <div class="feature-card">
          <h4>${module.title}</h4>
          <ul>
            ${module.goals.map((goal) => `<li>${goal}</li>`).join("")}
          </ul>
        </div>
      `
        )
        .join("")}
    </div>
    <div class="feature-card">
      <h4>Question Preview</h4>
      <ul>
        ${previewQuestions.map((q) => `<li>${q}</li>`).join("")}
      </ul>
    </div>
    <div class="quest-list">
      ${igcseQuests
        .map(
          (quest) => `
        <div class="quest-row">
          <div>
            <strong>${quest.title}</strong>
            <div class="muted">${quest.description}</div>
          </div>
          <button class="secondary add-igcse-quest" data-title="${quest.title}" data-description="${quest.description}" data-reward="${quest.reward}">Add Quest</button>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  elements.igcseDetail.querySelectorAll(".add-igcse-quest").forEach((button) => {
    button.addEventListener("click", () => {
      quests.push({
        id: Date.now(),
        title: button.dataset.title,
        type: "learning",
        reward: Number(button.dataset.reward),
        description: button.dataset.description,
        exercises: [
          "Complete the steps listed in the course outline.",
          "Record a 60-second explanation.",
          "Upload notes or evidence for review.",
        ],
      });
      renderQuests();
      showToast("Quest added to board.");
    });
  });
};

const renderIb = () => {
  if (!elements.ibList) return;
  elements.ibList.innerHTML = "";
  const search = (elements.ibSearch?.value || "").trim().toLowerCase();
  const list = ibSubjects.filter((item) => item.name.toLowerCase().includes(search));
  list.forEach((item) => {
    const button = document.createElement("button");
    button.className = "igcse-item";
    button.innerHTML = `<strong>${item.name}</strong><span class="muted">${item.code}</span>`;
    button.addEventListener("click", () => showIbDetail(item));
    elements.ibList.appendChild(button);
  });
  if (list.length && !elements.ibDetail.dataset.hasSelection) {
    showIbDetail(list[0]);
  }
};

const showIbDetail = (item) => {
  document.querySelectorAll("#ibList .igcse-item").forEach((el) => {
    el.classList.toggle("is-active", el.textContent.includes(item.code));
  });
  elements.ibDetail.dataset.hasSelection = "1";
  const questions = getIbQuestions(item.name);
  const ibQuestPack = buildIbQuests(item.name);
  const course = buildIbCourse(item.name);
  elements.ibDetail.innerHTML = `
    <h3>${item.name}</h3>
    <p class="muted">Code: ${item.code}</p>
    <div class="feature-grid">
      ${course
        .map(
          (module) => `
        <div class="feature-card">
          <h4>${module.title}</h4>
          <ul>
            ${module.goals.map((goal) => `<li>${goal}</li>`).join("")}
          </ul>
        </div>`
        )
        .join("")}
    </div>
    <div class="feature-card">
      <h4>Question Preview</h4>
      <ul>
        ${questions.map((q) => `<li>${q}</li>`).join("")}
      </ul>
    </div>
    <div class="quest-list">
      ${ibQuestPack
        .map(
          (quest) => `
        <div class="quest-row">
          <div>
            <strong>${quest.title}</strong>
            <div class="muted">${quest.description}</div>
          </div>
          <button class="secondary add-ib-quest" data-title="${quest.title}" data-description="${quest.description}" data-reward="${quest.reward}">Add Quest</button>
        </div>`
        )
        .join("")}
    </div>
  `;
  elements.ibDetail.querySelectorAll(".add-ib-quest").forEach((button) => {
    button.addEventListener("click", () => {
      const questionSet = getIbQuestions(item.name);
      quests.push({
        id: Date.now(),
        title: button.dataset.title,
        type: "learning",
        reward: Number(button.dataset.reward),
        description: button.dataset.description,
        exercises: [
          "Complete one full written response.",
          "Annotate your own answer with rubric criteria.",
          "Upload notes or typed answer as evidence.",
        ],
        questions: questionSet.slice(0, 4),
      });
      renderQuests();
      showToast("IB quest added to board.");
    });
  });
};

const loadIgcse = async () => {
  try {
    const response = await fetch("data/igcse.json");
    if (!response.ok) throw new Error("no data");
    state.igcse = await response.json();
  } catch (error) {
    state.igcse = igcseFallback;
  }
  state.igcse = state.igcse.map((item) => ({
    ...item,
    group: classifyGroup(item.name),
  }));
  renderIgcse();
};

const initIgcse = () => {
  elements.igcseSearch.addEventListener("input", renderIgcse);
  elements.igcseFilter.addEventListener("change", renderIgcse);
};

const initIb = () => {
  if (!elements.ibSearch) return;
  elements.ibSearch.addEventListener("input", renderIb);
  renderIb();
};

const initProfilePhoto = () => {
  const avatarButton = elements.profileAvatar;
  const input = elements.profilePhotoInput;
  avatarButton.addEventListener("click", () => {
    if (!state.user) {
      showToast("Sign in to update your profile photo.");
      return;
    }
    input.click();
  });

  input.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file || !state.user) return;
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = String(e.target?.result || "");
        localStorage.setItem(`guild.avatar.${state.user.uid}`, dataUrl);
        updateProfileUI(state.user);
        showToast("Profile photo updated.");
      };
      reader.readAsDataURL(file);
    } catch (error) {
      showToast("Profile photo upload failed.");
    }
  });
};

const applyStoredAvatar = (user) => {
  if (!user) return;
  const stored = localStorage.getItem(`guild.avatar.${user.uid}`);
  if (stored) {
    elements.profileAvatar.innerHTML = `<img src="${stored}" alt="Profile" />`;
  }
};

const initSettingsSidebar = () => {
  const openBtn = document.getElementById("openSettings");
  const closeBtn = document.getElementById("closeSettings");
  const sidebar = document.getElementById("settingsSidebar");
  const compact = document.getElementById("compactMode");
  const themeRadios = document.querySelectorAll("input[name='themeMode']");
  let languageSelect = document.getElementById("languageSelect");

  // Backward-compatible: if index.html is older, inject language controls at runtime.
  if (!languageSelect && sidebar) {
    const languageStack = document.createElement("div");
    languageStack.className = "stack";
    languageStack.innerHTML = `
      <label class="muted" id="settingsLanguageLabel">Language</label>
      <select id="languageSelect" class="text-input"></select>
    `;
    const compactBlock = document.getElementById("compactMode")?.closest(".stack");
    if (compactBlock && compactBlock.parentNode) {
      compactBlock.parentNode.insertBefore(languageStack, compactBlock);
    } else {
      sidebar.appendChild(languageStack);
    }
    languageSelect = document.getElementById("languageSelect");
  }

  const savedTheme = localStorage.getItem("guild.theme") || "dark";
  document.body.setAttribute("data-theme", savedTheme);
  themeRadios.forEach((radio) => {
    radio.checked = radio.value === savedTheme;
    radio.addEventListener("change", () => {
      document.body.setAttribute("data-theme", radio.value);
      localStorage.setItem("guild.theme", radio.value);
    });
  });

  const compactSaved = localStorage.getItem("guild.compact") === "1";
  compact.checked = compactSaved;
  if (compactSaved) document.body.setAttribute("data-compact", "1");
  compact.addEventListener("change", () => {
    if (compact.checked) {
      document.body.setAttribute("data-compact", "1");
      localStorage.setItem("guild.compact", "1");
    } else {
      document.body.removeAttribute("data-compact");
      localStorage.setItem("guild.compact", "0");
    }
  });

  if (languageSelect) {
    languageSelect.innerHTML = languageOptions
      .map((item) => `<option value="${item.code}">${item.label}</option>`)
      .join("");
    const savedLanguage = localStorage.getItem("guild.language") || "en";
    languageSelect.value = savedLanguage;
    languageSelect.addEventListener("change", () => {
      localStorage.setItem("guild.language", languageSelect.value);
      applyLanguage(languageSelect.value);
    });
    applyLanguage(savedLanguage);
  } else {
    applyLanguage(localStorage.getItem("guild.language") || "en");
  }

  openBtn.addEventListener("click", () => {
    sidebar.classList.add("is-open");
    sidebar.setAttribute("aria-hidden", "false");
  });
  closeBtn.addEventListener("click", () => {
    sidebar.classList.remove("is-open");
    sidebar.setAttribute("aria-hidden", "true");
  });
};

const init = () => {
  // One-time migration to ensure every local user starts from zero stats.
  if (localStorage.getItem("guild.statsResetV2") !== "1") {
    resetAllLocalStats();
    localStorage.setItem("guild.statsResetV2", "1");
  }
  loadAbout();
  renderQuests();
  renderSponsors();
  renderTimeline();
  initQuestFilters();
  initNavigation();
  initContact();
  initSignup();
  initPasswordToggles();
  initPreferences();
  initProfilePhoto();
  initAccountSettings();
  initAiRoutingToggle();
  initAdminRequests();
  initSelfAdminRequest();
  initAdminMembers();
  initStatsControls();
  initSettingsSidebar();
  initGoogleSignIn();
  initAppleSignIn();
  initAboutModal();
  initVerification();
  initIgcse();
  initIb();
  loadIgcse();

  onAuthStateChanged(auth, (user) => setUser(user));
  renderStats();
};

init();
