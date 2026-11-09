// בדיקות לחישוב התעריפים. הרצה: node --test
process.env.TZ = "Asia/Jerusalem";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { calcCost, estimateCost, validateTariff, parseDays, validateDiscounts, bestCost } = require("./tariff.js");

// 8.11.2026 הוא יום ראשון
const at = (day, hour, minute = 0) => new Date(2026, 10, 8 + day, hour, minute);
const SUN = 0, THU = 4, FRI = 5, SAT = 6;
const cost = (tariff, start, minutes) => calcCost(tariff, start, minutes).total;

const markers = JSON.parse(fs.readFileSync(__dirname + "/marker.json", "utf8"));
// עותק קבוע של תעריפים אמיתיים (מ-28.10.2026), כדי שעדכון מחיר ב-marker.json לא יכשיל את הבדיקות
const EXAMPLES = {
    "התבור 2 וויט סיטי": [
        {
            "label": "ראשון עד חמישי, 06:00–16:00",
            "days": "א-ה",
            "entry": "06:00-16:00",
            "hour": 20,
            "max": 70,
            "until": "06:00"
        },
        {
            "label": "ראשון עד חמישי, 16:00–06:00",
            "days": "א-ה",
            "entry": "16:00-06:00",
            "flat": 24,
            "until": "06:00"
        },
        {
            "label": "שישי עד שבת",
            "days": "ו-ש",
            "entry": "06:00-06:00",
            "hour": 35,
            "max": 120,
            "until": "06:00"
        }
    ],
    "עזריאלי תל אביב": [
        {
            "label": "שישי–שבת",
            "days": "ו-ש",
            "minute": 0.4,
            "max": 25
        },
        {
            "label": "ערב (כניסה 17:00–24:00)",
            "entry": "17:00-24:00",
            "minute": 0.4,
            "max": 25
        },
        {
            "label": "יום",
            "minute": 0.4,
            "max": 100
        }
    ],
    "ברוריה": [
        {
            "label": "ראשון–שישי, יום",
            "days": "א-ו",
            "entry": "07:00-18:00",
            "hour": 24,
            "grace": 15
        },
        {
            "label": "ראשון–שישי, ערב ולילה",
            "days": "א-ו",
            "entry": "18:00-07:00",
            "flat": 36,
            "until": "07:00",
            "grace": 15
        },
        {
            "label": "שבת",
            "days": "ש",
            "entry": "07:00-07:00",
            "flat": 36,
            "until": "07:00",
            "grace": 15
        }
    ]
};
const tariffOf = name => EXAMPLES[name];

test("ימים בעברית", () => {
    assert.deepStrictEqual(parseDays("א-ה"), [0, 1, 2, 3, 4]);
    assert.deepStrictEqual(parseDays("ו-ש"), [5, 6]);
    assert.deepStrictEqual(parseDays("א-ד,ו"), [0, 1, 2, 3, 5]);
    assert.strictEqual(parseDays("ז"), null);
});

test("כל התעריפים ב-marker.json תקינים", () => {
    for (const m of markers.filter(m => m.tariff)) {
        assert.deepStrictEqual(validateTariff(m.tariff), [], m.note);
    }
});

test("שגיאות בתעריף מזוהות", () => {
    assert.ok(validateTariff([{ days: "ז", hour: 10 }]).length > 0);
    assert.ok(validateTariff([{ hour: 10, flat: 20 }]).length > 0);
    assert.ok(validateTariff([{ rates: [{ hour: 10 }, { hour: 5 }] }]).length > 0); // רק המקטע האחרון פתוח
    assert.ok("error" in calcCost([{ entry: "07:00-18:00", hour: 10 }], at(SUN, 20), 60)); // אין תעריף בשעה הזו
});

test("סנטרל פארק התבור 2: יום, ערב, שישי-שבת", () => {
    const t = tariffOf("התבור 2 וויט סיטי");
    assert.strictEqual(cost(t, at(SUN, 8), 180), 60);        // 3 שעות × 20
    assert.strictEqual(cost(t, at(SUN, 8), 300), 70);        // מקסימום יומי
    assert.strictEqual(cost(t, at(SUN, 15), 180), 60);       // נכנס ביום, נשאר לערב: לפי שעת הכניסה
    assert.strictEqual(cost(t, at(SUN, 20), 180), 24);       // כניסה חד פעמית בערב
    assert.strictEqual(cost(t, at(FRI, 10), 120), 70);       // שישי: 35 לשעה
    assert.strictEqual(cost(t, at(SUN, 3), 60), 35);         // ראשון 03:00 עדיין שייך לשבת (עד 06:00)
    assert.strictEqual(cost(t, at(SAT, 2), 60), 35);         // שבת 02:00 שייך לשישי
    assert.strictEqual(cost(t, at(SUN, 8), 26 * 60), 140);   // עד 06:00 למחרת 70, ואז יום חדש 70
    assert.strictEqual(cost(t, at(THU, 22), 10 * 60), 94);   // חמישי בלילה 24, ומ-06:00 בשישי שעתיים × 35
});

test("עזריאלי תל אביב: מחיר לדקה, ערב ושישי-שבת", () => {
    const t = tariffOf("עזריאלי תל אביב");
    assert.strictEqual(cost(t, at(SUN, 10), 60), 24);
    assert.strictEqual(cost(t, at(SUN, 10), 90), 36);
    assert.strictEqual(cost(t, at(SUN, 10), 6 * 60), 100);   // מקסימום ליום
    assert.strictEqual(cost(t, at(SUN, 18), 120), 25);       // ערב: מקסימום 25
    assert.strictEqual(cost(t, at(SAT, 10), 180), 25);
});

test("אחוזות החוף ברוריה: 15 דקות חינם, שעתי ביום, חד פעמי בלילה ובשבת", () => {
    const t = tariffOf("ברוריה");
    assert.strictEqual(cost(t, at(SUN, 10), 10), 0);
    assert.strictEqual(cost(t, at(SUN, 10), 180), 72);
    assert.strictEqual(cost(t, at(SUN, 19), 180), 36);
    assert.strictEqual(cost(t, at(SAT, 12), 30), 36);
});

test("שעתיים ראשונות חינם, חיוב לפי רבע שעה, מקסימום למקטע", () => {
    const twoFree = [{ rates: [{ minutes: 120, hour: 0 }, { hour: 16 }] }];
    assert.strictEqual(cost(twoFree, at(SUN, 10), 120), 0);
    assert.strictEqual(cost(twoFree, at(SUN, 10), 180), 16);
    assert.strictEqual(cost([{ hour: 16, unit: 15 }], at(SUN, 10), 20), 8); // 2 רבעי שעה
    const malcha = [{ rates: [{ minutes: 180, minute: 0.3, max: 7 }, { minute: 0.3 }], max: 90 }];
    assert.strictEqual(cost(malcha, at(SUN, 10), 240), 25);  // 7 על 3 שעות + 18 על השעה הרביעית
    assert.strictEqual(cost([{ days: "ש", free: true }, { hour: 10 }], at(SAT, 10), 120), 0);
    // שנקר 2: שעה ראשונה או חלק ממנה 15, אחר כך 3 לכל רבע שעה או חלק ממנו
    const shenkar = [{ rates: [{ minutes: 60, hour: 15, unit: 60 }, { hour: 12, unit: 15 }], max: 35 }];
    assert.strictEqual(cost(shenkar, at(SUN, 10), 10), 15);
    assert.strictEqual(cost(shenkar, at(SUN, 10), 61), 18);
    assert.strictEqual(cost(shenkar, at(SUN, 10), 90), 21);
    assert.strictEqual(cost(shenkar, at(SUN, 10), 600), 35);
    // חניה ברחוב: בתשלום 08:00-19:00 לפי שעות בפועל, חינם בשאר הזמן
    const street = [
        { days: "א-ה", entry: "08:00-19:00", hour: 6, until: "19:00" },
        { entry: "19:00-08:00", free: true, until: "08:00" }];
    assert.strictEqual(cost(street, at(SUN, 18), 180), 6);   // 18:00-19:00 בתשלום, אחר כך חינם
    assert.strictEqual(cost(street, at(SUN, 7), 120), 6);    // 07:00-08:00 חינם, 08:00-09:00 בתשלום
});

test("הערכה לחניון בלי תעריף מפורט", () => {
    const simple = { color: "violet", hourly: "20", daily: "100" };
    assert.deepStrictEqual(estimateCost(simple, at(SUN, 10), 180), { total: 60, parts: [], approximate: true });
    assert.strictEqual(estimateCost(simple, at(SUN, 10), 600).total, 100);
    assert.strictEqual(estimateCost({ color: "black", hourly: "", daily: "" }, at(SUN, 10), 600).total, 0);
    assert.strictEqual(estimateCost({ ...simple, hourly: "24*", daily: "80*" }, at(SUN, 10), 60).total, 24);
    assert.strictEqual(estimateCost({ tariff: tariffOf("ברוריה") }, at(SUN, 10), 180).approximate, false);
});

test("כל ההנחות ב-marker.json תקינות", () => {
    for (const m of markers.filter(m => m.discounts)) {
        assert.deepStrictEqual(validateDiscounts(m.discounts), [], m.note);
    }
    assert.ok(validateDiscounts([{ who: "pilot", percent: 50 }]).length > 0);
    assert.ok(validateDiscounts([{ who: "app", percent: 50, free: true }]).length > 0);
});

test("הנחות: הזולה מבין אלה שמתאימות לפרופיל", () => {
    const lot = {
        color: "violet", hourly: "24", daily: "576", tariff: tariffOf("ברוריה"),
        discounts: [
            { who: "resident:תל אביב-יפו", percent: 75 },
            { who: "wheelchair", free: true },
            { who: "disabled", free_minutes: 120 },
            { who: "app", tariff: [{ hour: 10 }] }
        ]
    };
    const start = at(SUN, 10), three = 180;
    assert.strictEqual(bestCost(lot, start, three, {}).total, 72);                                  // בלי הנחות
    assert.strictEqual(bestCost(lot, start, three, {}).discount, null);
    assert.strictEqual(bestCost(lot, start, three, { city: "תל אביב-יפו" }).total, 18);            // 75% הנחה
    assert.strictEqual(bestCost(lot, start, three, { city: "חיפה" }).total, 72);
    assert.strictEqual(bestCost(lot, start, three, { app: true }).total, 30);                       // מחירון אפליקציה
    assert.strictEqual(bestCost(lot, start, three, { app: true, city: "תל אביב-יפו" }).total, 18);  // הזולה מבין השתיים
    assert.strictEqual(bestCost(lot, start, three, { disabled: true }).total, 24);                  // שעתיים חינם, משלמים על השלישית
    assert.strictEqual(bestCost(lot, start, three, { wheelchair: true }).total, 0);                 // כסא גלגלים: חינם
    assert.strictEqual(bestCost(lot, start, three, { wheelchair: true }).base, 72);
});
