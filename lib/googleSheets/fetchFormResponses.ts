import { google } from "googleapis";

function getAuth() {
  const privateKey = (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export type FormResponseRow = {
  timestamp: string;
  department: string;
  employeeCells: Record<string, string>;
};

function extractEmployeeName(header: string): string | null {
  const match = header.match(/^(.+?)'s Tasks Today/);
  return match ? match[1].trim() : null;
}

export async function fetchFormResponses(): Promise<FormResponseRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.PRODUCTIVITY_SHEET_ID!;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Form Responses!A1:Z10000",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = rows[0] as string[];
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const employeeCells: Record<string, string> = {};

    headers.forEach((header, colIndex) => {
      const name = extractEmployeeName(header);
      if (!name) return;
      const cellValue = (row[colIndex] ?? "").toString().trim();
      if (!cellValue) return;

      employeeCells[name] = employeeCells[name]
        ? `${employeeCells[name]} ${cellValue}`
        : cellValue;
    });

    return {
      timestamp: (row[0] ?? "").toString(),
      department: (row[1] ?? "").toString().trim(),
      employeeCells,
    };
  });
}

export function sheetSerialToDate(serial: number): Date {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + serial * 86400000);
}
