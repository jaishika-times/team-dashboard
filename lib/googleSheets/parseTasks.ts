export type ParsedTaskRow = {
  taskName: string | null;
  taskDescription: string | null;
  hoursSpent: number | null;
  entryStatus: "task" | "leave" | "no_tasks" | "unparsed";
  leaveLabel: string | null;
  rawCellText: string;
  parseConfidence: "high" | "low";
  sortOrder: number;
};

const LEAVE_PATTERNS = [
  /^sl$/i,
  /^al$/i,
  /^el$/i,
  /^mc$/i,
  /^ul$/i,
  /^on al$/i,
  /^on leave$/i,
  /^sick leave$/i,
  /^annual leave$/i,
  /^emergency leave$/i,
  /^half[\s-]?day$/i,
  /on leave today/i,
  /is on leave/i,
];

const NO_TASK_PATTERNS = [/^-$/, /^0\.0$/, /^0$/, /^na$/i, /^n\/a$/i];

function stripInvisibleChars(s: string): string {
  return s.replace(/[\u2060\u200B\uFEFF]/g, "");
}

function splitNumberedSegments(raw: string): string[] {
  const cleaned = stripInvisibleChars(raw).trim();
  const markerRegex = /(?:^|\s)(\d{1,2})[.)]\s*/g;
  const markers: { index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRegex.exec(cleaned)) !== null) {
    markers.push({ index: m.index + m[0].indexOf(m[1]) - (m[0].startsWith(" ") ? 0 : 0) });
  }

  if (markers.length === 0) {
    return [cleaned];
  }

  const segments: string[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = cleaned.indexOf(".", markers[i].index) + 1;
    const end = i + 1 < markers.length ? markers[i + 1].index : cleaned.length;
    const seg = cleaned.slice(start, end).trim();
    if (seg) segments.push(seg);
  }
  return segments.length ? segments : [cleaned];
}

function splitTaskSegment(segment: string): {
  project: string | null;
  task: string | null;
  hours: number | null;
  confident: boolean;
} {
  const parts = segment.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { project: null, task: null, hours: null, confident: false };

  const last = parts[parts.length - 1];
  const hoursMatch = last.match(/^(\d+(?:\.\d+)?)$/);

  if (hoursMatch && parts.length >= 2) {
    const hours = parseFloat(hoursMatch[1]);
    const project = parts[0];
    const task = parts.slice(1, -1).join(", ") || parts[0];
    return { project, task, hours, confident: true };
  }

  return {
    project: parts[0] ?? null,
    task: parts.slice(1).join(", ") || null,
    hours: null,
    confident: false,
  };
}

export function parseEmployeeTaskCell(rawCellText: string): ParsedTaskRow[] {
  const trimmed = (rawCellText ?? "").trim();

  if (!trimmed) {
    return [
      {
        taskName: null,
        taskDescription: null,
        hoursSpent: null,
        entryStatus: "no_tasks",
        leaveLabel: null,
        rawCellText: trimmed,
        parseConfidence: "high",
        sortOrder: 0,
      },
    ];
  }

  if (LEAVE_PATTERNS.some((re) => re.test(trimmed))) {
    return [
      {
        taskName: null,
        taskDescription: null,
        hoursSpent: null,
        entryStatus: "leave",
        leaveLabel: trimmed,
        rawCellText: trimmed,
        parseConfidence: "high",
        sortOrder: 0,
      },
    ];
  }

  if (NO_TASK_PATTERNS.some((re) => re.test(trimmed))) {
    return [
      {
        taskName: null,
        taskDescription: null,
        hoursSpent: null,
        entryStatus: "no_tasks",
        leaveLabel: null,
        rawCellText: trimmed,
        parseConfidence: "high",
        sortOrder: 0,
      },
    ];
  }

  const segments = splitNumberedSegments(trimmed);

  return segments.map((seg, i) => {
    const { project, task, hours, confident } = splitTaskSegment(seg);
    return {
      taskName: project,
      taskDescription: task,
      hoursSpent: hours,
      entryStatus: confident ? "task" : "unparsed",
      leaveLabel: null,
      rawCellText: seg,
      parseConfidence: confident ? "high" : "low",
      sortOrder: i,
    };
  });
}
