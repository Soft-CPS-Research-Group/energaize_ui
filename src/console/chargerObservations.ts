export interface ChargerObservation {
  id: string; timestamp: string; vehicle_id: string | null; association_known: boolean;
  generated: boolean | null; power_kw: number | null; soc: number | null; soc_generated: boolean | null; soc_unit: string;
}
export interface ObservedSession {
  vehicle: string; firstSeen: number; lastSeen: number; arrival: number | null; departure: number | null;
  generated: boolean; gap: boolean; peakCharge: number | null; peakDischarge: number | null;
}
/** A zero-power sample is never interpreted as an unplug. Gaps break evidence. */
export function observedSessions(samples: ChargerObservation[], previous: ChargerObservation | null, expectedSeconds = 15) {
  const sessions: ObservedSession[] = []; let session: ObservedSession | null = null; let prev = previous;
  for (const sample of samples) {
    const now = Date.parse(sample.timestamp);
    const contiguous = !!prev && now - Date.parse(prev.timestamp) <= expectedSeconds * 3000 && now >= Date.parse(prev.timestamp);
    const known = sample.association_known;
    if (session && (!contiguous || !known || sample.vehicle_id !== session.vehicle)) {
      if (contiguous && known) { session.departure = now; session.generated ||= sample.generated === true; } else session.gap = true;
      sessions.push(session); session = null;
    }
    if (known && sample.vehicle_id) {
      if (!session) session = { vehicle: sample.vehicle_id, firstSeen: now, lastSeen: now,
        arrival: contiguous && prev?.association_known && prev.vehicle_id !== sample.vehicle_id ? now : null,
        departure: null, generated: sample.generated === true || prev?.generated === true, gap: false,
        peakCharge: null, peakDischarge: null };
      session.lastSeen = now; session.generated ||= sample.generated === true;
      if (sample.power_kw !== null && Number.isFinite(sample.power_kw)) {
        session.peakCharge = Math.max(session.peakCharge ?? 0, sample.power_kw, 0);
        session.peakDischarge = Math.max(session.peakDischarge ?? 0, -sample.power_kw, 0);
      }
    }
    prev = sample;
  }
  if (session) sessions.push(session);
  return sessions;
}
