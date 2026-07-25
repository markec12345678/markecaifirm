// v4.9: AI Prompt Library — prednastavljeni AI prompti za različne kategorije
// Uporabnik lahko izbere predlogo in jo prilagodi v monitor formi.

export interface AiPromptTemplate {
  id: string;
  category: string;
  name: string;
  description: string;
  prompt: string;
  icon: string;
}

export const AI_PROMPT_TEMPLATES: AiPromptTemplate[] = [
  // ===== AVTO =====
  {
    id: 'auto-splosno',
    category: 'avto',
    name: 'Avto — splošno',
    description: 'Preveri stanje, servisno zgodovino, rjo, prevod. Pazi na "nujna prodaja" brez utemeljitve.',
    icon: '🚗',
    prompt: `Pozorno preveri:
- Stanje motorja in menjalnika (ali omenja vzdrževanje)
- Servisna zgodovina (zadnji servis, STD interval)
- Rja in stanje karoserije (pazljivo pri starejših avtih)
- Prevoženi kilometri glede na letnik (povprečno 15k/leto)
- Ali ima veljavno tehnično (STD)

Sumljivo če:
- "Nujna prodaja" brez utemeljitve
- Ni servisne zgodovine
- Cena bistveno pod tržno (>20% pod povprečjem)
- "Samo zamenjava" brez dokazila o lastništvu`,
  },
  {
    id: 'auto-mladi-voznik',
    category: 'avto',
    name: 'Avto — mladi voznik',
    description: 'Prvi avto do 5000€. Pazi na zanesljivost, ceno zavarovanja, stroške vzdrževanja.',
    icon: '🚙',
    prompt: `Prvi avto za mladega voznika. Pazi na:
- Zanesljivost modela (Toyota Yaris/Corolla, Honda Civic, VW Golf/Polo so dobri)
- Ceno zavarovanja (manjši motor = ceneje)
- Stroške vzdrževanja (poceni rezervni deli)
- Varnost (ESP, airbags)
- Porabo goriva (diesel je dražji za vzdrževanje)

Predlagaj povprečno tržno ceno za podobne modele in povej ali je oglas dobra priložnost za prvi avto.`,
  },
  {
    id: 'auto-oldtimer',
    category: 'avto',
    name: 'Avto — oldtimer/klubski',
    description: 'Starejši avtomobili (20+ let). Pazi na originalnost, stanje, dokumentacijo.',
    icon: '🏎️',
    prompt: `Oldtimer ali klubski avto. Posebno preveri:
- Originalnost (motor, notranjost, barva — original ali obnovljeno)
- Stanje karoserije (rja je glavna težava)
- Dokumentacijo (servisna knjiga, računi)
- Ali je registriran kot oldtimer (Y tablice)
- Zaloge rezervnih delov (so li dobni na trgu)

Pazi: "popolnoma obnovljen" mora imeti dokaze (fotografije, računi). Brez dokazov = sumljivo.`,
  },

  // ===== ELEKTRONIKA =====
  {
    id: 'elektronika-telefon',
    category: 'elektronika',
    name: 'Elektronika — telefon',
    description: 'Pametni telefoni. Pazi na stanje baterije, garantijo, embalažo, morebitne poškodbe.',
    icon: '📱',
    prompt: `Pametni telefon. Preveri:
- Stanje baterije (št. ciklov, % kapacitete)
- Garancijo (Ali še velja? AppleCare+?)
- Original embalažo in polnilec
- Stanje zaslona (praske, mrtvi piksli)
- Stanje zadnje strani in okvirja
- Ali je telefonska funkcija zaklenjena (iCloud, Google FRP)
- Starost modela (ali še dobiva update?)

Sumljivo če:
- Cena pod 50% tržne
- "Brez polnilca in embalaže"
- Ne pokaže stanja baterije
- "NUJNO" prodaja brez utemeljitve`,
  },
  {
    id: 'elektronika-racunalnik',
    category: 'elektronika',
    name: 'Elektronika — računalnik',
    description: 'Laptopi in namizniki. Preveri baterijo, SSD, RAM, morebitne poškodbe.',
    icon: '💻',
    prompt: `Prenosnik ali namizni računalnik. Preveri:
- Število ciklov baterije (pri prenosnikih)
- SSD/HDD stanje (SMART podatki)
- RAM (koliko, ali nadgradljiv)
- Stanje tipkovnice in zaslona
- Operacijski sistem (Ali legalen?)
- Starost in ali še dobiva update

Za Mac: preveri battery cycle count in AppleCare.
Za PC: preveri generacijo CPU in ali ima Windows licenco.`,
  },
  {
    id: 'elektronika-gaming',
    category: 'elektronika',
    name: 'Elektronika — gaming',
    description: 'Konzole (PS5, Xbox, Switch) in gaming oprema. Preveri stanje, igre, kontrollerje.',
    icon: '🎮',
    prompt: `Gaming konzola ali oprema. Preveri:
- Stanje konzole (disk drive, ventilatorji)
- Število kontrolerjev in njihovo stanje
- Ali vključuje igre (katere, physical/digital)
- Original embalažo in kable
- Ali je registrirana na račun (PSN/Xbox Live)
- Garancijo

Sumljivo če:
- Samo konzola brez kabla
- Cena pod 60% tržne
- Ne pokaže delovanja`,
  },

  // ===== NEPREMIČNINE =====
  {
    id: 'nepremicnine-stanovanje',
    category: 'nepremicnine',
    name: 'Nepremičnine — stanovanje',
    description: 'Stanovanja. Pazi na energijski razred, lokacijo, stroške (najemninica, rezervacija).',
    icon: '🏢',
    prompt: `Stanovanje. Preveri:
- Energijo razred (A/B so dražji ampak cenejši na dolgi rok)
- Lokacijo (okolica centra, promet, infrastruktura)
- Stroške (skupne storitve, rezervacija, najemnina zemljišča)
- Velikost in razporeditev (koliko m² koristnih)
- Starost stavbe in ali potrebuje obnovo
- Parkirno mesto (ali vključeno)
- Lastništvo (ali je etažno, ali so listine čiste)

Sumljivo če:
- Cena bistveno pod tržno (>30%)
- "Nujsni" prodajalec (pogosto res, ampak preveri)
- Ni veljavnih energetskih podatkov`,
  },
  {
    id: 'nepremicnine-hisa',
    category: 'nepremicnine',
    name: 'Nepremičnine — hiša',
    description: 'Hiše. Pazi na stanje strehe, instalacij, rja, vodo, energijski razred.',
    icon: '🏠',
    prompt: `Hiša. Preveri:
- Stanje strehe (starost, ali pušča)
- Instalacije (elektrika, voda, kanalizacija)
- Ogrevanje (plinsko, peč, toplotna črpalka)
- Energij razred (A/B = dražja ampak cenejša na dolgi rok)
- Vrt in okolico (ali je parcela v lasti)
- Parkirišče in dostop
- Ali hiša potrebuje obnovo (in koliko bi stala)

Sumljivo če:
- Ni omenjeno starost strehe
- "Samo zemljišče v najemu"
- Cena pod 50% tržne za okolico`,
  },

  // ===== ORODJE =====
  {
    id: 'orodje-akumulatorsko',
    category: 'orodje',
    name: 'Orodje — akumulatorsko',
    description: 'Akumulatorsko orodje (Bosch, Makita, DeWalt, Milwaukee). Preveri baterije, komplet, stanje.',
    icon: '🔧',
    prompt: `Akumulatorsko orodje. Preveri:
- Število in stanje baterij (Li-ion, kapaciteta)
- Polnilec vključen
- Original kovček
- Stanje (mazanje, poškodbe)
- Ali je profesionalni ali DIY razred (Bosch modri = Professional)
- Komlet (koliko orodij v setu)

Sumnjivo če:
- Samo orodje brez baterij
- "Kit" ponaredbe (cenejše ampak manj zanesljivo)
- Cena pod 50% tržne`,
  },

  // ===== MODA =====
  {
    id: 'moda-oblacila',
    category: 'moda',
    name: 'Moda — oblačila',
    description: 'Oblačila (Vinted, Bolha). Preveri pristnost, velikost, stanje, morebitne poškodbe.',
    icon: '👕',
    prompt: `Oblačila in modni dodatki. Preveri:
- Pristnost (za znamke: značke, šivi, material)
- Velikost in dolžino (primerjaj z merami)
- Stanje (rabljenost, madeži, poškodbe)
- Material (100% bombaž, usnje, volna)
- Ali je omenjeno pranje/kemično čiščenje

Za znamke kot Levi's, Nike, Adidas, Ralph Lauren — preveri pristnost (zadnja značka, logotip, šivi).`,
  },

  // ===== ŠPORT =====
  {
    id: 'sport-smuci',
    category: 'sport',
    name: 'Šport — smuči',
    description: 'Smuči in oprema. Preveri stanje drsne površine, robnikov, vezov.',
    icon: '⛷️',
    prompt: `Smuči in oprema. Preveri:
- Stanje drsne površine (prask, vrtinčkov)
- Robniki (ali so poškodovani)
- Vezovi (ali delujejo, ali so original)
- Dolžino smuči (glede na višino uporabnika)
- Starost (starejše od 5 let imajo manj vrednost)
- Znamko (Rossignol, Atomic, Salomon, Head so top)

Pazi: smuči so imele servis (struženje) ali ne.`,
  },

  // ===== INVESTICIJE =====
  {
    id: 'investicije-flip',
    category: 'investicije',
    name: 'Investicije — flip (prodajni)',
    description: 'Za flippanje — odkup poceni, prodaja dražje. Pazi na tržno vrednost in maržo.',
    icon: '💰',
    prompt: `Ta oglas analiziraj za FLIP (kupi poceni, prodaj dražje):
- Ali je cena dovolj pod tržno (vsaj 30% marža po stroških)
- Kakšna je likvidnost (kako hitro se podobni prodajo)
- Ali potrebuje investicijo (popravilo, čiščenje)
- Kakšna je končna prodajna cena (glede na tržno)
- Časovni okvir (moraš držati inventorij več mesecev?)

Oceni realen dobiček po vseh stroških (provizija, transport, popravila, čas).`,
  },
  {
    id: 'investicije-zbirateljstvo',
    category: 'investicije',
    name: 'Investicije — zbirateljstvo',
    description: 'Zbirateljski predmeti (numizmatika, filatelija, umetnine). Preveri pristnost in redkost.',
    icon: '🏺',
    prompt: `Zbirateljski predmet. Preveri:
- Pristnost (certifikat, ekspertiza)
- Redkost (koliko obstaja na trgu)
- Stanje (grading, ohranjenost)
- Provenienca (zgodovina lastništva)
- Tržna vrednost (zadnje prodaje na dražbah)
- Likvidnost (koliko časa do prodaje)

Pazi: certifikati morajo biti priznani (PCGS, NGC za kovance; PSA za kartice).`,
  },

  // ===== SPLOŠNO =====
  {
    id: 'splosno-previdno',
    category: 'splosno',
    name: 'Splošno — previdno',
    description: 'Splošno previden pristop. Pazi na vse sumljive znake.',
    icon: '⚠️',
    prompt: `Previdno analiziraj ta oglas:
- Ali je cena realna glede na tržno
- Ali prodajalec daje dovolj informacij
- Ali so slike resnične (ne stock foto)
- Ali je mogoče preveriti stanje pred nakupom
- Ali so morebitne nepravilnosti (preveč "NUDNO", premalo detailov)

Če karkoli sumljivo, oceni kot SUMNJIVO.`,
  },
];

export function getPromptsByCategory(category: string): AiPromptTemplate[] {
  if (category === 'all') return AI_PROMPT_TEMPLATES;
  return AI_PROMPT_TEMPLATES.filter(p => p.category === category);
}

export function getPromptById(id: string): AiPromptTemplate | undefined {
  return AI_PROMPT_TEMPLATES.find(p => p.id === id);
}

export const PROMPT_CATEGORIES = [
  { id: 'all', label: 'Vse', icon: '📋' },
  { id: 'avto', label: 'Avto', icon: '🚗' },
  { id: 'elektronika', label: 'Elektronika', icon: '📱' },
  { id: 'nepremicnine', label: 'Nepremičnine', icon: '🏠' },
  { id: 'orodje', label: 'Orodje', icon: '🔧' },
  { id: 'moda', label: 'Moda', icon: '👕' },
  { id: 'sport', label: 'Šport', icon: '⚽' },
  { id: 'investicije', label: 'Investicije', icon: '💰' },
  { id: 'splosno', label: 'Splošno', icon: '⚠️' },
];
