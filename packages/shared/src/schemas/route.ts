/**
 * JSON Schema for Route and related types (Maneuver, SpeedSegment, etc.)
 * Synchronized with types.ts Route and Maneuver interfaces
 */

/**
 * Eine Fahrspur. Drei BITMASKEN, kein Index mit einem Ja/Nein.
 *
 * Hier stand bis 0.17.3 ein Platzhalter (`lane_index`, `is_usable`), der nie
 * befuellt worden war. Er hatte mit Valhallas tatsaechlicher Antwort nichts
 * gemein -- siehe `types.ts#LaneInfo` und Valhallas API-Referenz.
 *
 * Die Obergrenze 2047 ist die Summe aller zwoelf Maskenwerte (0b111_1111_1111).
 * Ein groesserer Wert traegt Bits, die Valhalla nicht vergibt: dann stimmt die
 * Zuordnung nicht mehr, und die Anzeige zeigte Spuren, die es nicht gibt.
 */
export const laneInfoSchema = {
  type: 'object',
  properties: {
    directions: {
      type: 'integer',
      minimum: 0,
      maximum: 2047,
      description: 'Bitmask of every direction this lane allows (see SPUR)',
    },
    valid: {
      type: 'integer',
      minimum: 0,
      maximum: 2047,
      description: 'Directions matching the route — may still need a lane change',
    },
    active: {
      type: 'integer',
      minimum: 0,
      maximum: 2047,
      description: 'Directions for which this is the best lane (highlighted)',
    },
  },
  // Nur `directions` ist Pflicht: `valid` und `active` laesst Valhalla weg,
  // wo eine Spur fuer dieses Manoever gar nicht in Frage kommt.
  required: ['directions'],
  additionalProperties: false,
} as const;

/** Ein Eintrag auf einem Wegweiser. */
export const maneuverSignElementSchema = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'Sign text, e.g. "26", "A 61", "Ludwigshafen"',
    },
    consecutive_count: {
      type: 'integer',
      minimum: 0,
      description: 'How often this element appears across consecutive signs',
    },
  },
  required: ['text'],
  additionalProperties: false,
} as const;

/**
 * Was auf den Schildern an dieser Abzweigung steht.
 *
 * Alle vier Listen sind optional: Valhalla laesst weg, wofuer es keine Daten
 * gibt, und das ist ueberall ausser an Kreuzen und Abfahrten der Normalfall.
 */
export const maneuverSignSchema = {
  type: 'object',
  properties: {
    exit_number: { type: 'array', items: maneuverSignElementSchema },
    exit_branch: { type: 'array', items: maneuverSignElementSchema },
    exit_toward: { type: 'array', items: maneuverSignElementSchema },
    exit_name: { type: 'array', items: maneuverSignElementSchema },
  },
  required: [],
  additionalProperties: false,
} as const;

export const speedSegmentSchema = {
  type: 'object',
  properties: {
    begin_shape_index: {
      type: 'integer',
      minimum: 0,
      description: 'Start index in route geometry',
    },
    end_shape_index: {
      type: 'integer',
      minimum: 0,
      description: 'End index in route geometry',
    },
    kmh: {
      type: ['integer', 'null'],
      minimum: 5,
      maximum: 130,
      description: 'Speed limit in km/h (5–130 or null for unknown)',
    },
    road_class: {
      type: ['string', 'null'],
      description:
        "Valhalla's road class for this edge (motorway, trunk, primary, …) " +
        'or null. Feeds the VEHICLE speed limit: a motorhome over 3.5 t may ' +
        'drive less than the posted sign allows, and how much less depends ' +
        'on whether this is a motorway. See routing/fahrzeugTempo.ts.',
    },
  },
  // `road_class` ist NICHT required: eine Route, die vor 0.14.0 berechnet und
  // gespeichert wurde, hat das Feld nicht. Sie muss weiterhin gueltig sein --
  // sonst liesse sich nach einem Update keine laufende Fahrt fortsetzen.
  required: ['begin_shape_index', 'end_shape_index', 'kmh'],
  additionalProperties: false,
} as const;

export const routeWarningSchema = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: 'Warning code identifier',
    },
    message: {
      type: 'string',
      description: 'Human-readable warning message',
    },
  },
  required: ['code', 'message'],
  additionalProperties: false,
} as const;

export const routeLegSchema = {
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      minimum: 0,
      description: 'Leg index',
    },
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Leg distance in meters',
    },
    duration_s: {
      type: 'number',
      minimum: 0,
      description: 'Leg duration in seconds',
    },
  },
  required: ['index', 'distance_m', 'duration_s'],
  additionalProperties: false,
} as const;

export const maneuverSchema = {
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      minimum: 0,
      description: 'Maneuver index in route',
    },
    type: {
      type: 'string',
      description: 'Maneuver type (Valhalla enum, e.g. "turn_left", "roundabout_enter")',
    },
    instruction: {
      type: 'string',
      description: 'Localized instruction text',
    },
    street_names: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Names of streets involved',
    },
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Length of maneuver segment in meters',
    },
    begin_shape_index: {
      type: 'integer',
      minimum: 0,
      description: 'Start index in route geometry',
    },
    lanes: {
      type: ['array', 'null'],
      items: laneInfoSchema,
      description: 'Optional lane information',
    },
    sign: {
      ...maneuverSignSchema,
      description: 'What the road signs say at this junction, optional (0.17.3)',
    },
    duration_s: {
      type: 'number',
      minimum: 0,
      description: 'Planned duration of this maneuver segment in seconds (Valhalla time), optional (E04-T2)',
    },
  },
  // `sign` und `lanes` sind NICHT required: eine vor 0.17.3 berechnete und
  // gespeicherte Route hat sie nicht, und sie muss weiterhin gueltig sein --
  // sonst liesse sich nach einem Update keine laufende Fahrt fortsetzen.
  // Dieselbe Ueberlegung wie bei `road_class` in `speedSegmentSchema`.
  required: ['index', 'type', 'instruction', 'street_names', 'distance_m', 'begin_shape_index'],
  additionalProperties: false,
} as const;

export const routeSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Route identifier',
    },
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Total route distance in meters',
    },
    duration_s: {
      type: 'number',
      minimum: 0,
      description: 'Total route duration in seconds (Valhalla time, calibrated)',
    },
    geometry: {
      type: 'string',
      description: 'Encoded polyline (polyline6 format)',
    },
    legs: {
      type: 'array',
      items: routeLegSchema,
      description: 'Route segments between waypoints',
    },
    maneuvers: {
      type: 'array',
      items: maneuverSchema,
      description: 'Turn-by-turn instructions',
    },
    speed_limits: {
      type: 'array',
      items: speedSegmentSchema,
      description: 'Speed restrictions along route',
    },
    warnings: {
      type: 'array',
      items: routeWarningSchema,
      description: 'Route warnings (e.g. "restriction data missing")',
    },
  },
  required: ['id', 'distance_m', 'duration_s', 'geometry', 'legs', 'maneuvers', 'speed_limits', 'warnings'],
  additionalProperties: false,
} as const;
