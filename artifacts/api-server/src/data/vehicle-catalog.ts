// Curated catalog of car makes and models relevant for the Czech market.
// Used as a base dataset for the make/model autocomplete; merged with distinct
// values from the user's own vehicles table at runtime.

export const VEHICLE_CATALOG: Record<string, string[]> = {
  "Škoda": [
    "Fabia", "Octavia", "Superb", "Rapid", "Roomster", "Yeti", "Kodiaq", "Karoq",
    "Scala", "Kamiq", "Citigo", "Felicia", "Favorit", "Forman", "Enyaq", "105", "120", "130",
  ],
  "Volkswagen": [
    "Golf", "Passat", "Polo", "Tiguan", "Touareg", "Touran", "Caddy", "Transporter",
    "Crafter", "Sharan", "Up!", "T-Roc", "T-Cross", "Arteon", "Jetta", "Bora",
    "ID.3", "ID.4", "ID.5", "ID.7", "ID. Buzz", "Multivan", "Beetle", "Scirocco", "Phaeton",
  ],
  "Ford": [
    "Focus", "Fiesta", "Mondeo", "Kuga", "S-Max", "Galaxy", "Transit", "Transit Custom",
    "Tourneo", "Puma", "EcoSport", "Ka", "Ka+", "Escort", "Edge", "Ranger", "Mustang",
    "Mustang Mach-E", "Explorer", "B-Max", "C-Max",
  ],
  "Toyota": [
    "Yaris", "Yaris Cross", "Corolla", "Corolla Cross", "Avensis", "Auris",
    "RAV4", "Land Cruiser", "Hilux", "Aygo", "Aygo X", "C-HR", "Verso", "Prius",
    "ProAce", "Camry", "bZ4X", "Highlander", "Supra",
  ],
  "Hyundai": [
    "i10", "i20", "i30", "i40", "Tucson", "Santa Fe", "Kona", "ix35", "ix20",
    "Accent", "Getz", "Bayon", "Ioniq", "Ioniq 5", "Ioniq 6", "Staria",
  ],
  "Kia": [
    "Picanto", "Rio", "Ceed", "Cee'd", "ProCeed", "Optima", "Sportage", "Sorento",
    "Soul", "Stonic", "Niro", "Venga", "XCeed", "EV6", "EV9", "Stinger",
  ],
  "Renault": [
    "Clio", "Megane", "Scenic", "Captur", "Kadjar", "Koleos", "Twingo", "Talisman",
    "Laguna", "Trafic", "Master", "Kangoo", "Espace", "Zoe", "Arkana", "Austral", "Rafale",
  ],
  "Peugeot": [
    "107", "108", "206", "207", "208", "306", "307", "308", "406", "407", "508",
    "2008", "3008", "5008", "Partner", "Expert", "Boxer", "Bipper", "Rifter", "Traveller",
  ],
  "Citroën": [
    "C1", "C2", "C3", "C3 Aircross", "C4", "C4 Cactus", "C4 Picasso", "C5", "C5 Aircross",
    "Berlingo", "Jumper", "Jumpy", "Xsara", "ZX", "Saxo", "Nemo", "SpaceTourer",
  ],
  "Opel": [
    "Corsa", "Astra", "Insignia", "Meriva", "Zafira", "Mokka", "Crossland", "Grandland",
    "Combo", "Vivaro", "Movano", "Adam", "Karl", "Vectra", "Antara", "Frontera",
  ],
  "Fiat": [
    "Punto", "Panda", "500", "500L", "500X", "500e", "Tipo", "Bravo", "Stilo",
    "Doblo", "Ducato", "Scudo", "Multipla", "Croma", "Linea", "Qubo", "Fiorino",
  ],
  "BMW": [
    "1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "8 Series",
    "X1", "X2", "X3", "X4", "X5", "X6", "X7", "Z4", "i3", "i4", "i5", "i7", "iX", "iX1", "iX3",
    "M2", "M3", "M4", "M5",
  ],
  "Mercedes-Benz": [
    "A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLS",
    "GLA", "GLB", "GLC", "GLE", "GLS", "G-Class", "EQA", "EQB", "EQC", "EQE", "EQS", "EQV",
    "Sprinter", "Vito", "Viano", "V-Class", "Citan", "SLK", "SLC", "SL", "AMG GT",
  ],
  "Audi": [
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8",
    "Q2", "Q3", "Q4 e-tron", "Q5", "Q7", "Q8", "e-tron", "e-tron GT",
    "TT", "R8", "S3", "S4", "S5", "S6", "RS3", "RS4", "RS6", "RS Q3",
  ],
  "Seat": [
    "Ibiza", "Leon", "Toledo", "Cordoba", "Altea", "Alhambra", "Arona", "Ateca", "Tarraco", "Mii",
  ],
  "Cupra": ["Formentor", "Ateca", "Leon", "Born", "Tavascan", "Terramar"],
  "Dacia": ["Logan", "Sandero", "Duster", "Lodgy", "Dokker", "Spring", "Jogger", "Bigster"],
  "Mazda": [
    "2", "3", "5", "6", "CX-3", "CX-5", "CX-30", "CX-50", "CX-60", "CX-90",
    "MX-5", "MX-30", "RX-8", "BT-50",
  ],
  "Honda": [
    "Jazz", "Civic", "Accord", "CR-V", "HR-V", "ZR-V", "e:Ny1", "Insight", "Legend", "Prelude",
  ],
  "Nissan": [
    "Micra", "Note", "Almera", "Primera", "Qashqai", "X-Trail", "Juke", "Leaf",
    "Pathfinder", "Pulsar", "Ariya", "Townstar", "Navara",
  ],
  "Suzuki": [
    "Swift", "Vitara", "S-Cross", "Jimny", "Ignis", "Splash", "SX4", "Baleno", "Across",
  ],
  "Mitsubishi": [
    "Colt", "Lancer", "Outlander", "ASX", "Eclipse Cross", "Space Star", "L200", "Pajero", "i-MiEV",
  ],
  "Volvo": [
    "V40", "V50", "V60", "V70", "V90", "S40", "S60", "S80", "S90",
    "XC40", "XC60", "XC70", "XC90", "C30", "C40", "EX30", "EX90",
  ],
  "Mini": ["Cooper", "Cooper S", "One", "Countryman", "Clubman", "Paceman", "Cabrio", "Electric"],
  "Tesla": ["Model S", "Model 3", "Model X", "Model Y", "Cybertruck", "Roadster"],
  "Jeep": [
    "Renegade", "Compass", "Cherokee", "Grand Cherokee", "Wrangler", "Gladiator", "Avenger",
  ],
  "Land Rover": [
    "Defender", "Discovery", "Discovery Sport", "Freelander",
    "Range Rover", "Range Rover Sport", "Range Rover Evoque", "Range Rover Velar",
  ],
  "Jaguar": ["XE", "XF", "XJ", "F-Type", "E-Pace", "F-Pace", "I-Pace"],
  "Porsche": ["911", "Boxster", "Cayman", "Cayenne", "Macan", "Panamera", "Taycan"],
  "Lexus": ["CT", "IS", "ES", "GS", "LS", "NX", "RX", "UX", "RZ", "LC", "LBX"],
  "Subaru": ["Impreza", "Legacy", "Forester", "Outback", "XV", "Levorg", "BRZ", "Solterra"],
  "Smart": ["ForTwo", "ForFour", "Roadster", "#1", "#3"],
  "Alfa Romeo": [
    "147", "156", "159", "166", "Giulia", "Stelvio", "Mito", "Giulietta", "Brera", "Tonale",
  ],
  "Chevrolet": [
    "Aveo", "Spark", "Cruze", "Captiva", "Orlando", "Lacetti", "Nubira", "Camaro", "Trax",
  ],
  "Chrysler": ["300C", "PT Cruiser", "Voyager", "Sebring", "Grand Voyager"],
  "MG": ["ZS", "HS", "MG4", "MG5", "Marvel R", "Cyberster"],
  "Lancia": ["Ypsilon", "Delta", "Musa", "Thema", "Phedra"],
  "Lada": ["Niva", "Vesta", "Granta", "Largus", "Kalina", "Priora", "2107", "2110", "Samara"],
  "Daewoo": ["Matiz", "Lanos", "Nubira", "Leganza", "Tacuma", "Kalos"],
  "SsangYong": ["Korando", "Rexton", "Tivoli", "Musso", "Actyon", "Kyron", "Torres"],
  "DS Automobiles": ["DS3", "DS4", "DS5", "DS7 Crossback", "DS9"],
  "Rover": ["25", "45", "75", "100", "200", "400", "600", "800"],
  "Saab": ["9-3", "9-5", "900", "9000", "9-7X"],
  "Iveco": ["Daily", "Eurocargo", "Massif", "Stralis"],
  "Tata": ["Indica", "Vista", "Indigo", "Safari", "Xenon"],
  "BYD": ["Atto 3", "Dolphin", "Seal", "Han", "Tang"],
  "NIO": ["ET5", "ET7", "EL6", "EL7"],
  "Polestar": ["1", "2", "3", "4"],
};

export const VEHICLE_MAKES: string[] = Object.keys(VEHICLE_CATALOG);
