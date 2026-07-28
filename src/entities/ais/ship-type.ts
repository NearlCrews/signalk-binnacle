const EXACT_SHIP_TYPES: Readonly<Record<number, string>> = {
  0: 'Not available',
  30: 'Fishing vessel',
  31: 'Towing vessel',
  32: 'Towing vessel with a large tow',
  33: 'Dredging or underwater operations vessel',
  34: 'Diving operations vessel',
  35: 'Military operations vessel',
  36: 'Sailing vessel',
  37: 'Pleasure craft',
  50: 'Pilot vessel',
  51: 'Search and rescue vessel',
  52: 'Tug',
  53: 'Port tender',
  54: 'Anti-pollution vessel',
  55: 'Law enforcement vessel',
  56: 'Local vessel',
  57: 'Local vessel',
  58: 'Medical transport',
  59: 'Noncombatant ship',
};

export function aisShipTypeLabel(id: number): string {
  if (!Number.isInteger(id) || id < 0 || id > 99) return 'Unknown ship type';
  const exact = EXACT_SHIP_TYPES[id];
  if (exact) return exact;
  if (id >= 20 && id <= 29) return 'Wing-in-ground craft';
  if (id >= 40 && id <= 49) return 'High-speed craft';
  if (id >= 60 && id <= 69) return 'Passenger ship';
  if (id >= 70 && id <= 79) return 'Cargo ship';
  if (id >= 80 && id <= 89) return 'Tanker';
  if (id >= 90) return 'Other vessel';
  return 'Unknown ship type';
}
