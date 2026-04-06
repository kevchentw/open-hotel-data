import Papa from "papaparse";

const CSV_COLUMNS = ["source_hotel_id", "hotel_name", "standard_points", "notes"];

// ── History JSON ───────────────────────────────────────────────────────────

export function parsePointsHistory(jsonString) {
  if (!jsonString || !jsonString.trim()) return { metadata: {}, hotels: {} };
  try {
    const parsed = JSON.parse(jsonString);
    return { metadata: parsed.metadata ?? {}, hotels: parsed.hotels ?? {} };
  } catch {
    return { metadata: {}, hotels: {} };
  }
}

export function updatePointsHistory(history, sourceHotelId, standardPointsPrice, capturedAt) {
  return {
    metadata: history.metadata,
    hotels: {
      ...history.hotels,
      [sourceHotelId]: {
        standard_lowest_points_price: standardPointsPrice,
        captured_at: capturedAt
      }
    }
  };
}

export function serializePointsHistory(history, updatedAt) {
  return `${JSON.stringify({ metadata: { updated_at: updatedAt }, hotels: history.hotels }, null, 2)}\n`;
}

// ── Manual CSV ─────────────────────────────────────────────────────────────

export function parseManualCsv(csvString) {
  const map = new Map();
  if (!csvString || !csvString.trim()) return map;
  const result = Papa.parse(csvString.trim(), { header: true, skipEmptyLines: true });
  for (const row of result.data) {
    if (row.source_hotel_id) {
      map.set(row.source_hotel_id, {
        hotel_name: row.hotel_name ?? "",
        standard_points: row.standard_points ?? "",
        notes: row.notes ?? ""
      });
    }
  }
  return map;
}

export function serializeManualCsv(manualMap) {
  const rows = [...manualMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source_hotel_id, { hotel_name, standard_points, notes }]) => ({
      source_hotel_id,
      hotel_name,
      standard_points,
      notes
    }));
  if (rows.length === 0) return `${CSV_COLUMNS.join(",")}\n`;
  return `${Papa.unparse(rows, { columns: CSV_COLUMNS })}\n`;
}

export function buildManualCsvRow(sourceHotelId, hotelName) {
  return { source_hotel_id: sourceHotelId, hotel_name: hotelName, standard_points: "", notes: "" };
}

// ── Resolution ─────────────────────────────────────────────────────────────

export function resolveStandardPointsPrice(currentStandard, historyEntry, manualValue) {
  if (currentStandard) return currentStandard;
  if (historyEntry?.standard_lowest_points_price) return historyEntry.standard_lowest_points_price;
  if (manualValue) return manualValue;
  return "";
}

export function shouldAddToManualCsv(currentStandard, historyEntry, manualEntry) {
  return !currentStandard && !historyEntry && !manualEntry;
}
