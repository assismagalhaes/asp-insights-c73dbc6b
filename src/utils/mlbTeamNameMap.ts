export const MLB_TEAM_KEYS = [
  "arizona_diamondbacks",
  "athletics",
  "atlanta_braves",
  "baltimore_orioles",
  "boston_red_sox",
  "chicago_cubs",
  "chicago_white_sox",
  "cincinnati_reds",
  "cleveland_guardians",
  "colorado_rockies",
  "detroit_tigers",
  "houston_astros",
  "kansas_city_royals",
  "los_angeles_angels",
  "los_angeles_dodgers",
  "miami_marlins",
  "milwaukee_brewers",
  "minnesota_twins",
  "new_york_mets",
  "new_york_yankees",
  "philadelphia_phillies",
  "pittsburgh_pirates",
  "san_diego_padres",
  "san_francisco_giants",
  "seattle_mariners",
  "st_louis_cardinals",
  "tampa_bay_rays",
  "texas_rangers",
  "toronto_blue_jays",
  "washington_nationals",
] as const;

export type MlbTeamKey = (typeof MLB_TEAM_KEYS)[number];

export const MLB_TEAM_DISPLAY_NAMES: Record<MlbTeamKey, string> = {
  arizona_diamondbacks: "Arizona Diamondbacks",
  athletics: "Athletics",
  atlanta_braves: "Atlanta Braves",
  baltimore_orioles: "Baltimore Orioles",
  boston_red_sox: "Boston Red Sox",
  chicago_cubs: "Chicago Cubs",
  chicago_white_sox: "Chicago White Sox",
  cincinnati_reds: "Cincinnati Reds",
  cleveland_guardians: "Cleveland Guardians",
  colorado_rockies: "Colorado Rockies",
  detroit_tigers: "Detroit Tigers",
  houston_astros: "Houston Astros",
  kansas_city_royals: "Kansas City Royals",
  los_angeles_angels: "Los Angeles Angels",
  los_angeles_dodgers: "Los Angeles Dodgers",
  miami_marlins: "Miami Marlins",
  milwaukee_brewers: "Milwaukee Brewers",
  minnesota_twins: "Minnesota Twins",
  new_york_mets: "New York Mets",
  new_york_yankees: "New York Yankees",
  philadelphia_phillies: "Philadelphia Phillies",
  pittsburgh_pirates: "Pittsburgh Pirates",
  san_diego_padres: "San Diego Padres",
  san_francisco_giants: "San Francisco Giants",
  seattle_mariners: "Seattle Mariners",
  st_louis_cardinals: "St. Louis Cardinals",
  tampa_bay_rays: "Tampa Bay Rays",
  texas_rangers: "Texas Rangers",
  toronto_blue_jays: "Toronto Blue Jays",
  washington_nationals: "Washington Nationals",
};

const EXTRA_ALIASES: Record<string, MlbTeamKey> = {
  arizona: "arizona_diamondbacks",
  diamondbacks: "arizona_diamondbacks",
  dbacks: "arizona_diamondbacks",
  ari: "arizona_diamondbacks",
  oakland_athletics: "athletics",
  oakland_as: "athletics",
  as: "athletics",
  athletics: "athletics",
  ath: "athletics",
  atlanta: "atlanta_braves",
  braves: "atlanta_braves",
  atl: "atlanta_braves",
  baltimore: "baltimore_orioles",
  orioles: "baltimore_orioles",
  bal: "baltimore_orioles",
  boston: "boston_red_sox",
  red_sox: "boston_red_sox",
  bos: "boston_red_sox",
  cubs: "chicago_cubs",
  chi_cubs: "chicago_cubs",
  chc: "chicago_cubs",
  white_sox: "chicago_white_sox",
  chi_white_sox: "chicago_white_sox",
  cws: "chicago_white_sox",
  cin: "cincinnati_reds",
  cincy_reds: "cincinnati_reds",
  reds: "cincinnati_reds",
  cle: "cleveland_guardians",
  guardians: "cleveland_guardians",
  indians: "cleveland_guardians",
  cleveland_indians: "cleveland_guardians",
  col: "colorado_rockies",
  rockies: "colorado_rockies",
  det: "detroit_tigers",
  tigers: "detroit_tigers",
  hou: "houston_astros",
  astros: "houston_astros",
  kc_royals: "kansas_city_royals",
  kansas_city: "kansas_city_royals",
  royals: "kansas_city_royals",
  kc: "kansas_city_royals",
  la_angels: "los_angeles_angels",
  l_a_angels: "los_angeles_angels",
  anaheim_angels: "los_angeles_angels",
  angels: "los_angeles_angels",
  laa: "los_angeles_angels",
  la_dodgers: "los_angeles_dodgers",
  l_a_dodgers: "los_angeles_dodgers",
  dodgers: "los_angeles_dodgers",
  lad: "los_angeles_dodgers",
  los_angeles_dodgers: "los_angeles_dodgers",
  mia: "miami_marlins",
  marlins: "miami_marlins",
  fla_marlins: "miami_marlins",
  mil: "milwaukee_brewers",
  brewers: "milwaukee_brewers",
  min: "minnesota_twins",
  twins: "minnesota_twins",
  ny_mets: "new_york_mets",
  n_y_mets: "new_york_mets",
  mets: "new_york_mets",
  nym: "new_york_mets",
  ny_yankees: "new_york_yankees",
  n_y_yankees: "new_york_yankees",
  yankees: "new_york_yankees",
  nyy: "new_york_yankees",
  phi: "philadelphia_phillies",
  phillies: "philadelphia_phillies",
  pit: "pittsburgh_pirates",
  pirates: "pittsburgh_pirates",
  sd_padres: "san_diego_padres",
  padres: "san_diego_padres",
  sdp: "san_diego_padres",
  sd: "san_diego_padres",
  sf_giants: "san_francisco_giants",
  giants: "san_francisco_giants",
  sfg: "san_francisco_giants",
  sf: "san_francisco_giants",
  sea: "seattle_mariners",
  mariners: "seattle_mariners",
  st_louis: "st_louis_cardinals",
  saint_louis_cardinals: "st_louis_cardinals",
  saint_louis: "st_louis_cardinals",
  cardinals: "st_louis_cardinals",
  stl: "st_louis_cardinals",
  stl_cardinals: "st_louis_cardinals",
  tb_rays: "tampa_bay_rays",
  tampa: "tampa_bay_rays",
  rays: "tampa_bay_rays",
  tbr: "tampa_bay_rays",
  tex: "texas_rangers",
  rangers: "texas_rangers",
  tor: "toronto_blue_jays",
  blue_jays: "toronto_blue_jays",
  jays: "toronto_blue_jays",
  was: "washington_nationals",
  wsh: "washington_nationals",
  nationals: "washington_nationals",
  nats: "washington_nationals",
};

export const MLB_TEAM_ALIASES: Record<string, MlbTeamKey> = {
  ...Object.fromEntries(MLB_TEAM_KEYS.map((key) => [key, key] as const)),
  ...Object.fromEntries(
    Object.entries(MLB_TEAM_DISPLAY_NAMES).map(([key, name]) => [
      normalizeMlbTeamText(name),
      key as MlbTeamKey,
    ]),
  ),
  ...EXTRA_ALIASES,
};

export function normalizeMlbTeamText(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(l\.?\s*a\.?|la)\b/gi, "la")
    .replace(/\b(n\.?\s*y\.?|ny)\b/gi, "ny")
    .replace(/\b(s\.?\s*f\.?|sf)\b/gi, "sf")
    .replace(/\b(s\.?\s*d\.?|sd)\b/gi, "sd")
    .replace(/\b(t\.?\s*b\.?|tb)\b/gi, "tb")
    .replace(/\b(st\.?|saint)\b\s*/gi, "st ")
    .replace(/['`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function matchMlbTeamName(input: string | null | undefined): MlbTeamKey | null {
  const normalized = normalizeMlbTeamText(String(input ?? ""));
  if (!normalized) return null;
  return MLB_TEAM_ALIASES[normalized] ?? null;
}

export function canonicalMlbTeamName(teamKey: string | null | undefined) {
  return MLB_TEAM_DISPLAY_NAMES[teamKey as MlbTeamKey] ?? String(teamKey ?? "");
}
