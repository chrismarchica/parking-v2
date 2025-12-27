/**
 * NYC Police Precinct centroid coordinates.
 * 
 * These are approximate centroids for NYPD precincts used for map visualization.
 * Source: NYC Open Data NYPD Precinct boundaries
 */

export interface PrecinctLocation {
  precinct: string;
  name: string;
  lat: number;
  lon: number;
  borough: string;
}

/**
 * Precinct centroids for NYC.
 * Coordinates are approximate center points of each precinct area.
 */
export const PRECINCT_LOCATIONS: Record<string, PrecinctLocation> = {
  // Manhattan South
  '1': { precinct: '1', name: '1st Precinct', lat: 40.7094, lon: -74.0086, borough: 'Manhattan' },
  '5': { precinct: '5', name: '5th Precinct', lat: 40.7145, lon: -73.9997, borough: 'Manhattan' },
  '6': { precinct: '6', name: '6th Precinct', lat: 40.7315, lon: -74.0014, borough: 'Manhattan' },
  '7': { precinct: '7', name: '7th Precinct', lat: 40.7139, lon: -73.9833, borough: 'Manhattan' },
  '9': { precinct: '9', name: '9th Precinct', lat: 40.7272, lon: -73.9877, borough: 'Manhattan' },
  '10': { precinct: '10', name: '10th Precinct', lat: 40.7422, lon: -74.0059, borough: 'Manhattan' },
  '13': { precinct: '13', name: '13th Precinct', lat: 40.7370, lon: -73.9830, borough: 'Manhattan' },
  
  // Manhattan Midtown
  '14': { precinct: '14', name: 'Midtown South', lat: 40.7505, lon: -73.9934, borough: 'Manhattan' },
  '17': { precinct: '17', name: '17th Precinct', lat: 40.7527, lon: -73.9710, borough: 'Manhattan' },
  '18': { precinct: '18', name: 'Midtown North', lat: 40.7614, lon: -73.9776, borough: 'Manhattan' },
  '19': { precinct: '19', name: '19th Precinct', lat: 40.7700, lon: -73.9580, borough: 'Manhattan' },
  '20': { precinct: '20', name: '20th Precinct', lat: 40.7831, lon: -73.9750, borough: 'Manhattan' },
  
  // Manhattan North
  '22': { precinct: '22', name: 'Central Park', lat: 40.7812, lon: -73.9665, borough: 'Manhattan' },
  '23': { precinct: '23', name: '23rd Precinct', lat: 40.7957, lon: -73.9370, borough: 'Manhattan' },
  '24': { precinct: '24', name: '24th Precinct', lat: 40.7980, lon: -73.9680, borough: 'Manhattan' },
  '25': { precinct: '25', name: '25th Precinct', lat: 40.8030, lon: -73.9370, borough: 'Manhattan' },
  '26': { precinct: '26', name: '26th Precinct', lat: 40.8120, lon: -73.9550, borough: 'Manhattan' },
  '28': { precinct: '28', name: '28th Precinct', lat: 40.8160, lon: -73.9460, borough: 'Manhattan' },
  '30': { precinct: '30', name: '30th Precinct', lat: 40.8240, lon: -73.9450, borough: 'Manhattan' },
  '32': { precinct: '32', name: '32nd Precinct', lat: 40.8180, lon: -73.9400, borough: 'Manhattan' },
  '33': { precinct: '33', name: '33rd Precinct', lat: 40.8500, lon: -73.9350, borough: 'Manhattan' },
  '34': { precinct: '34', name: '34th Precinct', lat: 40.8650, lon: -73.9270, borough: 'Manhattan' },
  
  // Bronx
  '40': { precinct: '40', name: '40th Precinct', lat: 40.8170, lon: -73.9200, borough: 'Bronx' },
  '41': { precinct: '41', name: '41st Precinct', lat: 40.8240, lon: -73.8940, borough: 'Bronx' },
  '42': { precinct: '42', name: '42nd Precinct', lat: 40.8310, lon: -73.9020, borough: 'Bronx' },
  '43': { precinct: '43', name: '43rd Precinct', lat: 40.8330, lon: -73.8650, borough: 'Bronx' },
  '44': { precinct: '44', name: '44th Precinct', lat: 40.8280, lon: -73.9180, borough: 'Bronx' },
  '45': { precinct: '45', name: '45th Precinct', lat: 40.8280, lon: -73.8260, borough: 'Bronx' },
  '46': { precinct: '46', name: '46th Precinct', lat: 40.8530, lon: -73.9100, borough: 'Bronx' },
  '47': { precinct: '47', name: '47th Precinct', lat: 40.8770, lon: -73.8640, borough: 'Bronx' },
  '48': { precinct: '48', name: '48th Precinct', lat: 40.8560, lon: -73.8880, borough: 'Bronx' },
  '49': { precinct: '49', name: '49th Precinct', lat: 40.8690, lon: -73.8530, borough: 'Bronx' },
  '50': { precinct: '50', name: '50th Precinct', lat: 40.8800, lon: -73.9050, borough: 'Bronx' },
  '52': { precinct: '52', name: '52nd Precinct', lat: 40.8670, lon: -73.8970, borough: 'Bronx' },
  
  // Brooklyn North
  '60': { precinct: '60', name: '60th Precinct', lat: 40.5770, lon: -73.9780, borough: 'Brooklyn' },
  '61': { precinct: '61', name: '61st Precinct', lat: 40.5920, lon: -73.9570, borough: 'Brooklyn' },
  '62': { precinct: '62', name: '62nd Precinct', lat: 40.6070, lon: -73.9880, borough: 'Brooklyn' },
  '63': { precinct: '63', name: '63rd Precinct', lat: 40.6180, lon: -73.9300, borough: 'Brooklyn' },
  '66': { precinct: '66', name: '66th Precinct', lat: 40.6320, lon: -73.9870, borough: 'Brooklyn' },
  '67': { precinct: '67', name: '67th Precinct', lat: 40.6570, lon: -73.9350, borough: 'Brooklyn' },
  '68': { precinct: '68', name: '68th Precinct', lat: 40.6340, lon: -74.0250, borough: 'Brooklyn' },
  '69': { precinct: '69', name: '69th Precinct', lat: 40.6380, lon: -73.9030, borough: 'Brooklyn' },
  '70': { precinct: '70', name: '70th Precinct', lat: 40.6480, lon: -73.9610, borough: 'Brooklyn' },
  '71': { precinct: '71', name: '71st Precinct', lat: 40.6620, lon: -73.9510, borough: 'Brooklyn' },
  '72': { precinct: '72', name: '72nd Precinct', lat: 40.6610, lon: -73.9970, borough: 'Brooklyn' },
  '73': { precinct: '73', name: '73rd Precinct', lat: 40.6780, lon: -73.9120, borough: 'Brooklyn' },
  '75': { precinct: '75', name: '75th Precinct', lat: 40.6720, lon: -73.8740, borough: 'Brooklyn' },
  '76': { precinct: '76', name: '76th Precinct', lat: 40.6820, lon: -74.0010, borough: 'Brooklyn' },
  '77': { precinct: '77', name: '77th Precinct', lat: 40.6760, lon: -73.9590, borough: 'Brooklyn' },
  '78': { precinct: '78', name: '78th Precinct', lat: 40.6810, lon: -73.9750, borough: 'Brooklyn' },
  '79': { precinct: '79', name: '79th Precinct', lat: 40.6900, lon: -73.9390, borough: 'Brooklyn' },
  '81': { precinct: '81', name: '81st Precinct', lat: 40.6910, lon: -73.9190, borough: 'Brooklyn' },
  '83': { precinct: '83', name: '83rd Precinct', lat: 40.7000, lon: -73.9290, borough: 'Brooklyn' },
  '84': { precinct: '84', name: '84th Precinct', lat: 40.6930, lon: -73.9900, borough: 'Brooklyn' },
  '88': { precinct: '88', name: '88th Precinct', lat: 40.6940, lon: -73.9750, borough: 'Brooklyn' },
  '90': { precinct: '90', name: '90th Precinct', lat: 40.7110, lon: -73.9530, borough: 'Brooklyn' },
  '94': { precinct: '94', name: '94th Precinct', lat: 40.7260, lon: -73.9520, borough: 'Brooklyn' },
  
  // Queens North
  '100': { precinct: '100', name: '100th Precinct', lat: 40.5840, lon: -73.8250, borough: 'Queens' },
  '101': { precinct: '101', name: '101st Precinct', lat: 40.6060, lon: -73.7530, borough: 'Queens' },
  '102': { precinct: '102', name: '102nd Precinct', lat: 40.6930, lon: -73.8480, borough: 'Queens' },
  '103': { precinct: '103', name: '103rd Precinct', lat: 40.6990, lon: -73.7920, borough: 'Queens' },
  '104': { precinct: '104', name: '104th Precinct', lat: 40.7130, lon: -73.8970, borough: 'Queens' },
  '105': { precinct: '105', name: '105th Precinct', lat: 40.7290, lon: -73.7380, borough: 'Queens' },
  '106': { precinct: '106', name: '106th Precinct', lat: 40.6720, lon: -73.8410, borough: 'Queens' },
  '107': { precinct: '107', name: '107th Precinct', lat: 40.7330, lon: -73.8180, borough: 'Queens' },
  '108': { precinct: '108', name: '108th Precinct', lat: 40.7450, lon: -73.9410, borough: 'Queens' },
  '109': { precinct: '109', name: '109th Precinct', lat: 40.7630, lon: -73.8310, borough: 'Queens' },
  '110': { precinct: '110', name: '110th Precinct', lat: 40.7490, lon: -73.8710, borough: 'Queens' },
  '111': { precinct: '111', name: '111th Precinct', lat: 40.7560, lon: -73.7630, borough: 'Queens' },
  '112': { precinct: '112', name: '112th Precinct', lat: 40.7290, lon: -73.8530, borough: 'Queens' },
  '113': { precinct: '113', name: '113th Precinct', lat: 40.6890, lon: -73.7620, borough: 'Queens' },
  '114': { precinct: '114', name: '114th Precinct', lat: 40.7680, lon: -73.9230, borough: 'Queens' },
  '115': { precinct: '115', name: '115th Precinct', lat: 40.7570, lon: -73.9020, borough: 'Queens' },
  
  // Staten Island
  '120': { precinct: '120', name: '120th Precinct', lat: 40.6370, lon: -74.0770, borough: 'Staten Island' },
  '121': { precinct: '121', name: '121st Precinct', lat: 40.5370, lon: -74.1990, borough: 'Staten Island' },
  '122': { precinct: '122', name: '122nd Precinct', lat: 40.5640, lon: -74.1180, borough: 'Staten Island' },
  '123': { precinct: '123', name: '123rd Precinct', lat: 40.5250, lon: -74.2370, borough: 'Staten Island' },
};

/**
 * Get location for a precinct code
 */
export function getPrecinctLocation(precinct: string): PrecinctLocation | null {
  return PRECINCT_LOCATIONS[precinct] || null;
}

/**
 * Get all known precinct locations
 */
export function getAllPrecinctLocations(): PrecinctLocation[] {
  return Object.values(PRECINCT_LOCATIONS);
}

