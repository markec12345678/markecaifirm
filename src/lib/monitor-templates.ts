// v4.6: Monitor Template Library
// Prednastavljeni monitorji za običajne scenarije.
// Vsak template je povsem konfiguriran (source, URL, filters, prompt, tags).

export type Source = 'bolha' | 'nepremicnine' | 'avtonet' | 'salomon' | 'vinted' | 'custom-rss';

export interface MonitorTemplate {
  id: string;
  name: string;
  description: string;
  category: 'elektronika' | 'avto' | 'nepremicnine' | 'moda' | 'orodje' | 'sport' | 'drugo';
  source: Source;
  sourceUrl: string;
  keywords: string;
  excludeKeywords: string;
  minPrice: number | null;
  maxPrice: number | null;
  intervalMinutes: number;
  customPrompt: string;
  tags: string;
  icon: string; // emoji
}

export const MONITOR_TEMPLATES: MonitorTemplate[] = [
  // ===== ELEKTRONIKA =====
  {
    id: 'tpl-iphone-13-pro',
    name: 'iPhone 13 Pro — Bolha',
    description: 'iPhone 13 Pro na Bolhi, cene do 500€. AI pazi na stanje in embalažo.',
    category: 'elektronika',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/index.php?ctl=search&A_3_1=iphone+13+pro&A_12_1=1&A_0_1=0&sort=new',
    keywords: 'iphone 13 pro',
    excludeKeywords: 'case,maska,ekran,zascitnik,baterija,zamenjava,poplavljeno,pokvarjen',
    minPrice: 200,
    maxPrice: 500,
    intervalMinutes: 15,
    customPrompt: 'Posebej pazi na oglase, ki vsebujejo "nujna prodaja", "selim se", "rabim denar" — pogosto so podcenjeni. Preveri ali je omenjen original polnilec in embalaža. Sumljivo če cena pod 250€.',
    tags: 'elektronika,iphone,bolha',
    icon: '📱',
  },
  {
    id: 'tpl-macbook-pro-m1',
    name: 'MacBook Pro M1 — Bolha',
    description: 'MacBook Pro M1 13"/14", do 1000€. Pazi na baterijo in zanka.',
    category: 'elektronika',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/index.php?ctl=search&A_3_1=macbook+pro+m1&A_12_1=1&A_0_1=0&sort=new',
    keywords: 'macbook pro,m1',
    excludeKeywords: 'case,torbica,nalagalnik,zascitnik,tipkovnica,miska',
    minPrice: 600,
    maxPrice: 1000,
    intervalMinutes: 20,
    customPrompt: 'Preveri število ciklov baterije (idealno <300). Pazi na zanka (AppleCare). Sumnjivo če prodajalec noče pokazati sistema in logov.',
    tags: 'elektronika,macbook,bolha',
    icon: '💻',
  },
  {
    id: 'tpl-ps5-bolha',
    name: 'PlayStation 5 — Bolha',
    description: 'PS5 konzole z ali brez iger, do 500€.',
    category: 'elektronika',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/index.php?ctl=search&A_3_1=playstation+5&A_12_1=1&A_0_1=0&sort=new',
    keywords: 'ps5,playstation 5',
    excludeKeywords: 'case,držalo,kabel,usb,controller,stikalo',
    minPrice: 300,
    maxPrice: 500,
    intervalMinutes: 15,
    customPrompt: 'Preveri ali je omenjena original škatla in kabel. Pazi na razliko med PS5 in PS5 Digital. Sumnjivo če cena pod 350€.',
    tags: 'elektronika,gaming,bolha',
    icon: '🎮',
  },

  // ===== AVTO =====
  {
    id: 'tpl-golf-mk6',
    name: 'VW Golf MK6 — Avtonet',
    description: 'Golf 6, do 6000€, letnik 2008-2012. Idealno za mlade voznike.',
    category: 'avto',
    source: 'avtonet',
    sourceUrl: 'https://www.avto.net/adresults.asp?znamka=VOLKSWAGEN&model=GOLF&cenaMIN=0&cenaMAX=6000',
    keywords: 'golf',
    excludeKeywords: 'golf 7,golf 5,golf 4',
    minPrice: 3000,
    maxPrice: 6000,
    intervalMinutes: 30,
    customPrompt: 'Pazi na servisno zgodovino. Zadnji servis mora biti nedaven. Preveri STD (servisni interval) in stanje zavor. Sumljivo če "samo zamenjava" ali "nujno" brez utemeljitve.',
    tags: 'avto,golf,avtonet',
    icon: '🚗',
  },
  {
    id: 'tpl-a3-8l',
    name: 'Audi A3 8L — Avtonet',
    description: 'Audi A3 8L (1996-2003), do 3000€. Klubski avto.',
    category: 'avto',
    source: 'avtonet',
    sourceUrl: 'https://www.avto.net/adresults.asp?znamka=AUDI&model=A3&cenaMIN=0&cenaMAX=3000',
    keywords: 'a3',
    excludeKeywords: 'a4,a6,a3 8p',
    minPrice: 1000,
    maxPrice: 3000,
    intervalMinutes: 60,
    customPrompt: 'Starejši avto — preveri rjo, stanje motorja (1.6 ali 1.8T so zanesljivi). Pazi na "nujno prodaja" in dokaze o lastništvu. Pazljivo z "zamenjava".',
    tags: 'avto,audi,avtonet,klubski',
    icon: '🚙',
  },
  {
    id: 'tpl-yaris-hybrid',
    name: 'Toyota Yaris Hybrid — Avtonet',
    description: 'Yaris Hybrid (2012+), do 9000€. Idealno za mesto.',
    category: 'avto',
    source: 'avtonet',
    sourceUrl: 'https://www.avto.net/adresults.asp?znamka=TOYOTA&model=YARIS&cenaMIN=5000&cenaMAX=9000',
    keywords: 'yaris,hybrid',
    excludeKeywords: '',
    minPrice: 5000,
    maxPrice: 9000,
    intervalMinutes: 30,
    customPrompt: 'Hybrid baterija naj bo original in brez napak (preveri SSE). Pazi na razliko med 1.5 in 1.0 (samo 1.5 je hybrid). Letnik 2012+ je bolj zanesljiv.',
    tags: 'avto,toyota,hybrid,mesto',
    icon: '🚘',
  },

  // ===== NEPREMIČNINE =====
  {
    id: 'tpl-2sob-lj',
    name: '2-sobno LJ mesto — Nepremičnine',
    description: '2-sobna stanovanja v Ljubljani, do 200k. RSS vir.',
    category: 'nepremicnine',
    source: 'nepremicnine',
    sourceUrl: 'https://www.nepremicnine.net/oglasi-prodaja/ljubljana-mesto/stanovanje/2-sobno/cena-od-1-do-200-tisoč-evrov/?output=rss',
    keywords: '',
    excludeKeywords: 'podnajem,običajna,delitev',
    minPrice: 50000,
    maxPrice: 200000,
    intervalMinutes: 60,
    customPrompt: 'Pazi na lokacijo (okolica centra je dražja ampak boljša). Preveri energijski razred (A/B so dražji ampak cenejši na dolgi rok). Sumljivo če pod 80k brez utemeljitve.',
    tags: 'nepremicnine,ljubljana,investicija',
    icon: '🏢',
  },
  {
    id: 'tpl-hisa-bela-krajina',
    name: 'Hiša Bela krajina — Nepremičnine',
    description: 'Hiše v Beli krajini, do 150k. Za umik iz mesta.',
    category: 'nepremicnine',
    source: 'nepremicnine',
    sourceUrl: 'https://www.nepremicnine.net/oglasi-prodaja/bela-krajina/hisa/?output=rss',
    keywords: '',
    excludeKeywords: '',
    minPrice: 30000,
    maxPrice: 150000,
    intervalMinutes: 120,
    customPrompt: 'Preveri stanje strehe in instalacij. Pazi na hiše, ki potrebujejo obnovo (lahko so dober deal). Lokacija: Črnomelj, Metlika, Semič so bolj zanesljive.',
    tags: 'nepremicnine,bela-krajina,hisa',
    icon: '🏠',
  },
  {
    id: 'tpl-garaza-lj',
    name: 'Garaža LJ — Nepremičnine',
    description: 'Garaže v Ljubljani, do 25k. Solidna investicija.',
    category: 'nepremicnine',
    source: 'nepremicnine',
    sourceUrl: 'https://www.nepremicnine.net/oglasi-prodaja/ljubljana-mesto/garaza/?output=rss',
    keywords: 'garaza',
    excludeKeywords: 'parkirno mesto',
    minPrice: 8000,
    maxPrice: 25000,
    intervalMinutes: 60,
    customPrompt: 'Preveri legalnost (ali ima garaža lastništvo ali je samo najem zemljišča). Pazi na velikost — standardna garaža naj bi bila vsaj 12m².',
    tags: 'nepremicnine,ljubljana,garaza,investicija',
    icon: '🅿️',
  },

  // ===== MODA =====
  {
    id: 'tpl-nike-air-max-vinted',
    name: 'Nike Air Max — Vinted',
    description: 'Nike Air Max na Vinted, do 80€. Pazi na pristnost.',
    category: 'moda',
    source: 'vinted',
    sourceUrl: 'https://www.vinted.si/api/v2/catalog/items?search_text=nike%20air%20max&order_by=newest_first',
    keywords: 'nike,air max',
    excludeKeywords: '',
    minPrice: 20,
    maxPrice: 80,
    intervalMinutes: 30,
    customPrompt: 'Preveri pristnost — šivi, embalaža, logotip. Sumljivo če pod 30€ za nove. Pazi na velikost in stanje.',
    tags: 'moda,nike,vinted',
    icon: '👟',
  },
  {
    id: 'tpl-levis-501-vinted',
    name: 'Levi\'s 501 — Vinted',
    description: 'Levi\'s 501 jeans na Vinted, do 50€.',
    category: 'moda',
    source: 'vinted',
    sourceUrl: 'https://www.vinted.si/api/v2/catalog/items?search_text=levis%20501&order_by=newest_first',
    keywords: 'levis,501',
    excludeKeywords: '',
    minPrice: 15,
    maxPrice: 50,
    intervalMinutes: 45,
    customPrompt: 'Preveri pristnost — zadnja značka, notranje oznake. Pazi na velikost in dolžino. Original 501 imajo značilno rdečo zastavico na zadnjem žepu.',
    tags: 'moda,levis,vinted',
    icon: '👖',
  },

  // ===== ORODJE =====
  {
    id: 'tpl-bosch-orodje-bolha',
    name: 'Bosch orodje — Bolha',
    description: 'Bosch profesionalno orodje, do 200€.',
    category: 'orodje',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/orodja?query=bosch',
    keywords: 'bosch',
    excludeKeywords: 'rezervni,del,nadomestek',
    minPrice: 30,
    maxPrice: 200,
    intervalMinutes: 60,
    customPrompt: 'Preveri stanje baterij (pri cordless). Pazi na razliko med zelenim (DIY) in modrim (Professional) Bosch. Original polnilci in kovček so plus.',
    tags: 'orodje,bosch,bolha',
    icon: '🔧',
  },
  {
    id: 'tpl-makita-orodje-bolha',
    name: 'Makita orodje — Bolha',
    description: 'Makita profesionalno orodje, do 300€.',
    category: 'orodje',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/orodja?query=makita',
    keywords: 'makita',
    excludeKeywords: 'rezervni,del',
    minPrice: 50,
    maxPrice: 300,
    intervalMinutes: 60,
    customPrompt: 'Makita 18V LXT serija je najboljša. Preveri število ciklov baterij. Pazi na razliko med original in kit ponaredki (kit ponaredki so cenejši ampak manj zanesljivi).',
    tags: 'orodje,makita,bolha',
    icon: '🛠️',
  },

  // ===== SPORT =====
  {
    id: 'tpl-golf-oprema-bolha',
    name: 'Golf oprema — Bolha',
    description: 'Golf palice in oprema, do 400€.',
    category: 'sport',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/sport?query=golf%20palice',
    keywords: 'golf,palica,železo,driver',
    excludeKeywords: '',
    minPrice: 50,
    maxPrice: 400,
    intervalMinutes: 90,
    customPrompt: 'Preveri komplet (koliko palic, kateri znamki). Pazi na starost —Titelist, Callaway, TaylorMade so top znamke. Set mora imeti vsaj driver, železa 4-PW, putter.',
    tags: 'sport,golf,bolha',
    icon: '⛳',
  },
  {
    id: 'tpl-smuci-bolha',
    name: 'Smuči — Bolha',
    description: 'Smuči in vezmi, do 250€.',
    category: 'sport',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/sport?query=smuči',
    keywords: 'smuči,smuci,vezni',
    excludeKeywords: '',
    minPrice: 30,
    maxPrice: 250,
    intervalMinutes: 90,
    customPrompt: 'Preveri stanje drsne površine in robnikov. Pazi na starost smuči (starejše od 5 let imajo manj vrednost). Znamke: Rossignol, Atomic, Salomon, Head.',
    tags: 'sport,smuci,bolha',
    icon: '⛷️',
  },

  // ===== DRUGO =====
  {
    id: 'tpl-kolo-bolha',
    name: 'Kolo — Bolha',
    description: 'Kolesa (MTB/cestna), do 600€.',
    category: 'drugo',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/kolesa?query=kolo',
    keywords: '',
    excludeKeywords: 'kolesar,del,reze',
    minPrice: 100,
    maxPrice: 600,
    intervalMinutes: 60,
    customPrompt: 'Preveri okvir (razpoke), stanje prestav (Shimano/SRAM), zavor in verige. Pazi na velikost okvirja. Sumljivo če kolo nima serijske številke.',
    tags: 'kolo,bolha,sport',
    icon: '🚴',
  },
  {
    id: 'tpl-rtv-bolha',
    name: 'RTV komponente — Bolha',
    description: 'Zvočniki, ojačevalci, predpojačevalci, do 500€.',
    category: 'elektronika',
    source: 'bolha',
    sourceUrl: 'https://www.bolha.com/elektronika?query=zvocniki',
    keywords: 'zvocnik,ojačevalec,amplifier',
    excludeKeywords: 'kabel,priključek',
    minPrice: 50,
    maxPrice: 500,
    intervalMinutes: 60,
    customPrompt: 'Preveri stanje membran in tuljav. Pazi na znamke: Bowers&Wilkins, KEF, Dynaudio, NAD, Marantz, Yamaha. Vintage ponavadi cenejše ampak boljše kvalitete.',
    tags: 'elektronika,rtv,bolha,audio',
    icon: '🔊',
  },
];

export function getTemplatesByCategory(category: MonitorTemplate['category'] | 'all'): MonitorTemplate[] {
  if (category === 'all') return MONITOR_TEMPLATES;
  return MONITOR_TEMPLATES.filter(t => t.category === category);
}

export function getTemplateById(id: string): MonitorTemplate | undefined {
  return MONITOR_TEMPLATES.find(t => t.id === id);
}
