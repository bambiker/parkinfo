// איסוף היסטוריה של תפוסת חניוני אחוזות החוף, לסטטיסטיקות.
// רץ מ-GitHub Actions (.github/workflows/collect-occupancy.yml) כל חצי שעה,
// ומוסיף שורה לקובץ של החודש בענף occupancy-data.
// הרצה ידנית: node scripts/collect-occupancy.js <תיקיית הנתונים>
const fs = require("node:fs");
const path = require("node:path");

const URL = "https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/970/query" +
    "?where=1%3D1&outFields=code_achoza,status_chenyon,tr_status_chenyon&returnGeometry=false&f=json";
// רק סטטוסים שאומרים משהו על התפוסה. "פעיל" (כנראה חניון בלי חיישן) וריק לא נשמרים.
const CODES = { "פנוי": "F", "מעט": "L", "מלא": "X", "סגור": "C" };

const README = `# היסטוריית תפוסה של חניוני אחוזות החוף

נאסף אוטומטית כל חצי שעה מ-scripts/collect-occupancy.js (בענף main),
מתוך שירות המפות הפתוח של עיריית תל אביב-יפו (שכבה 970, "חניוני אחוזות החוף").

קובץ לכל חודש: occupancy/YYYY-MM.csv, שורה לכל איסוף:

    time,statuses
    2026-11-19T16:52,10:F 11:L 33:X

- time: זמן העדכון של הנתונים אצל העירייה, בשעון ישראל.
- statuses: קוד החניון באחוזות החוף (השדה ahuzot ב-marker.json) וסטטוס:
  F = פנוי, L = מעט מקומות, X = מלא, C = סגור.
  חניונים בלי סטטוס תפוסה (למשל "פעיל") לא מופיעים.
- אם הנתונים אצל העירייה לא התעדכנו מאז האיסוף הקודם, לא נוספת שורה.
`;

async function fetchJson(url, tries = 3) {
    for (let i = 1; ; i++) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!r.ok) throw new Error("HTTP " + r.status);
            const d = await r.json();
            if (d.error) throw new Error(JSON.stringify(d.error));
            return d;
        } catch (e) {
            if (i >= tries) throw e;
            await new Promise(res => setTimeout(res, 5000 * i));
        }
    }
}

// זמן בשעון ישראל, בפורמט 2026-11-19T16:52
function israelTime(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

async function main() {
    const dir = process.argv[2] || "data";
    const d = await fetchJson(URL);
    const rows = (d.features || []).map(f => f.attributes || {});
    const items = rows
        .filter(a => a.code_achoza != null && CODES[(a.status_chenyon || "").trim()])
        .sort((a, b) => a.code_achoza - b.code_achoza);
    if (!items.length) throw new Error("אין סטטוסים בתשובה מהעירייה");

    const updated = Math.max(...items.map(a => a.tr_status_chenyon || 0)) || Date.now();
    const time = israelTime(updated);
    const line = `${time},${items.map(a => `${a.code_achoza}:${CODES[a.status_chenyon.trim()]}`).join(" ")}`;

    const file = path.join(dir, "occupancy", time.slice(0, 7) + ".csv");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(path.join(dir, "README.md"))) fs.writeFileSync(path.join(dir, "README.md"), README);
    if (!fs.existsSync(file)) fs.writeFileSync(file, "time,statuses\n");
    const last = fs.readFileSync(file, "utf8").trimEnd().split("\n").pop();
    if (last.startsWith(time + ",")) {
        console.log("הנתונים לא התעדכנו מאז האיסוף הקודם:", time);
        return;
    }
    fs.appendFileSync(file, line + "\n");
    console.log(`נשמרו ${items.length} חניונים, ${time}`);
}

main().catch(e => { console.error("האיסוף נכשל:", e.message); process.exit(1); });
