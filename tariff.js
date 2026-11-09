// תעריפים מפורטים לחניון ("tariff" ב-marker.json) וחישוב עלות לפי שעת כניסה ומשך חניה.
// הפורמט מתועד ב-TARIFFS.md. הקובץ עובד גם בדפדפן (window.ParkingTariff) וגם ב-Node (בדיקות).
(function (root) {
    const DAY_LETTERS = { "א": 0, "ב": 1, "ג": 2, "ד": 3, "ה": 4, "ו": 5, "ש": 6 };
    const MAX_DAYS = 31; // הגבלה על משך החישוב, שלא ייתקע על נתונים שגויים

    // "א-ה" / "ו" / "ש" / "א-ד,ו" -> [0,1,2,3,4]. בלי ימים = כל השבוע.
    function parseDays(text) {
        if (text === undefined || text === null || text === "") return [0, 1, 2, 3, 4, 5, 6];
        const days = new Set();
        for (const part of String(text).replace(/[׳'"\s]/g, "").split(",")) {
            const range = part.split("-");
            if (range.length > 2 || range.some(l => !(l in DAY_LETTERS))) return null;
            const from = DAY_LETTERS[range[0]], to = DAY_LETTERS[range[range.length - 1]];
            for (let d = from; ; d = (d + 1) % 7) { days.add(d); if (d === to) break; }
        }
        return [...days].sort();
    }

    // "07:30" -> 450 דקות מחצות. "24:00" מותר (סוף היום).
    function parseClock(text) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ""));
        if (!m) return null;
        const minutes = Number(m[1]) * 60 + Number(m[2]);
        return Number(m[2]) < 60 && minutes <= 24 * 60 ? minutes : null;
    }

    // "06:00-16:00" -> {from, to}. אם from >= to החלון עובר חצות (למשל 16:00-06:00).
    function parseWindow(text) {
        if (text === undefined || text === null || text === "") return { from: 0, to: 24 * 60 };
        const parts = String(text).split("-");
        if (parts.length !== 2) return null;
        const from = parseClock(parts[0].trim()), to = parseClock(parts[1].trim());
        return from === null || to === null ? null : { from, to };
    }

    function inWindow(win, minuteOfDay) {
        if (win.from < win.to) return minuteOfDay >= win.from && minuteOfDay < win.to;
        return minuteOfDay >= win.from || minuteOfDay < win.to;
    }

    // מחיר לשעה של מקטע: "hour" או "minute" (מחיר לדקה)
    function hourPrice(seg) {
        if (typeof seg.hour === "number") return seg.hour;
        if (typeof seg.minute === "number") return seg.minute * 60;
        return null;
    }

    function ruleSegments(rule) {
        if (Array.isArray(rule.rates)) return rule.rates;
        if (typeof rule.hour === "number" || typeof rule.minute === "number") return [{ hour: rule.hour, minute: rule.minute }];
        return null;
    }

    // מחזיר רשימת שגיאות (ריקה אם התעריף תקין)
    function validateTariff(tariff) {
        const errors = [];
        if (!Array.isArray(tariff) || tariff.length === 0) return ["tariff צריך להיות רשימה של כללים"];
        tariff.forEach((rule, i) => {
            const at = `כלל ${i + 1}: `;
            if (!rule || typeof rule !== "object") { errors.push(at + "לא אובייקט"); return; }
            if (parseDays(rule.days) === null) errors.push(at + `ימים לא תקינים "${rule.days}" (למשל "א-ה", "ו", "ש")`);
            if (parseWindow(rule.entry) === null) errors.push(at + `שעות כניסה לא תקינות "${rule.entry}" (למשל "06:00-16:00")`);
            if (rule.until !== undefined && parseClock(rule.until) === null) errors.push(at + `until לא תקין "${rule.until}"`);
            if (rule.hours !== undefined && !(typeof rule.hours === "number" && rule.hours > 0)) errors.push(at + "hours צריך להיות מספר חיובי");
            const kinds = [rule.free === true, typeof rule.flat === "number", ruleSegments(rule) !== null].filter(Boolean).length;
            if (kinds !== 1) errors.push(at + "צריך בדיוק אחד מ: free, flat, rates/hour/minute");
            const segs = ruleSegments(rule);
            if (segs) {
                if (segs.length === 0) errors.push(at + "rates ריק");
                segs.forEach((seg, j) => {
                    if (hourPrice(seg) === null || hourPrice(seg) < 0) errors.push(at + `מקטע ${j + 1} בלי מחיר (hour או minute)`);
                    if (j < segs.length - 1 && !(seg.minutes > 0)) errors.push(at + `מקטע ${j + 1} צריך minutes (רק האחרון פתוח)`);
                });
            }
            for (const key of ["max", "flat", "grace", "unit"]) {
                if (rule[key] !== undefined && !(typeof rule[key] === "number" && rule[key] >= 0)) errors.push(at + `${key} צריך להיות מספר`);
            }
        });
        return errors;
    }

    function findRule(tariff, when) {
        const minuteOfDay = when.getHours() * 60 + when.getMinutes();
        // חלון שעובר חצות שייך ליום שבו הוא התחיל: כניסה בשבת 02:00 לחלון "16:00-06:00" של שישי
        const yesterday = (when.getDay() + 6) % 7;
        return tariff.find(rule => {
            const win = parseWindow(rule.entry);
            if (!inWindow(win, minuteOfDay)) return false;
            const days = parseDays(rule.days);
            const startedYesterday = win.from >= win.to && minuteOfDay < win.to;
            return days.includes(startedYesterday ? yesterday : when.getDay());
        }) || null;
    }

    // סוף התקופה של כלל (מחיר חד פעמי או מקסימום יומי): עד שעה מסוימת למחרת או מספר שעות
    function periodEnd(rule, entry, defaultHours) {
        const until = rule.until !== undefined ? parseClock(rule.until) : null;
        if (until !== null) {
            const end = new Date(entry);
            end.setHours(0, until, 0, 0);
            if (end <= entry) end.setDate(end.getDate() + 1);
            return end;
        }
        return new Date(entry.getTime() + (rule.hours || defaultHours) * 3600000);
    }

    // עלות של חניה לפי מקטעי מחיר, עבור `minutes` דקות מתחילת התקופה
    function ratesCost(rule, minutes) {
        const unit = rule.unit > 0 ? rule.unit : 1;
        const billed = Math.ceil(minutes / unit) * unit;
        const segs = ruleSegments(rule);
        let total = 0, segStart = 0;
        for (let j = 0; j < segs.length && segStart < billed; j++) {
            const seg = segs[j];
            const segEnd = j === segs.length - 1 ? billed : Math.min(billed, segStart + seg.minutes);
            let cost = (segEnd - segStart) * hourPrice(seg) / 60;
            if (typeof seg.max === "number") cost = Math.min(cost, seg.max);
            total += cost;
            segStart = segEnd;
        }
        return typeof rule.max === "number" ? Math.min(total, rule.max) : total;
    }

    // כמה תעלה חניה שמתחילה ב-start ונמשכת minutes דקות.
    // מחזיר {total, parts: [{start, end, label, cost}]} או {error}.
    // הכלל נבחר לפי שעת הכניסה (כמו בשלטים: "התעריף נקבע לפי שעת הכניסה"),
    // וכשהתקופה שלו נגמרת (למשל "עד 06:00 למחרת") החישוב ממשיך כאילו נכנסו מחדש.
    function calcCost(tariff, start, minutes) {
        const errors = validateTariff(tariff);
        if (errors.length) return { error: errors.join("; ") };
        if (!(minutes > 0)) return { total: 0, parts: [] };
        if (minutes > MAX_DAYS * 24 * 60) return { error: `אפשר לחשב עד ${MAX_DAYS} ימים` };

        const parts = [];
        let entry = new Date(start), left = minutes, first = true;
        while (left > 0) {
            const rule = findRule(tariff, entry);
            if (!rule) return { error: "אין תעריף לשעת הכניסה הזו (ייתכן שהחניון סגור)", parts };
            if (first && typeof rule.grace === "number" && minutes <= rule.grace) {
                parts.push({ start: entry, end: new Date(entry.getTime() + minutes * 60000), label: rule.label || "", cost: 0 });
                break;
            }
            first = false;

            const end = rule.free ? null : periodEnd(rule, entry, 24);
            const periodMinutes = end ? Math.max(1, Math.round((end - entry) / 60000)) : left;
            const used = Math.min(left, periodMinutes);
            const cost = rule.free ? 0 : typeof rule.flat === "number" ? rule.flat : ratesCost(rule, used);
            const partEnd = new Date(entry.getTime() + used * 60000);
            parts.push({ start: entry, end: partEnd, label: rule.label || "", cost: Math.round(cost * 100) / 100 });
            entry = partEnd;
            left -= used;
        }
        const total = Math.round(parts.reduce((sum, p) => sum + p.cost, 0) * 100) / 100;
        return { total, parts };
    }

    // הערכה לחניון: לפי tariff אם יש ותקין, אחרת לפי המחיר השעתי והיומי (מוערך, approximate: true)
    function estimateCost(markerData, start, minutes) {
        if (markerData.tariff && validateTariff(markerData.tariff).length === 0) {
            return { ...calcCost(markerData.tariff, start, minutes), approximate: false };
        }
        if (markerData.color === "black" || markerData.color === "grey") return { total: 0, parts: [], approximate: true };
        const hourly = parseFloat(markerData.hourly), daily = parseFloat(markerData.daily);
        if (isNaN(hourly) && isNaN(daily)) return { error: "אין מחיר לחניון הזה" };
        let total = 0;
        for (let left = minutes; left > 0; left -= 24 * 60) {
            const day = Math.min(left, 24 * 60);
            const byHour = isNaN(hourly) ? Infinity : Math.ceil(day / 60) * hourly;
            total += Math.min(byHour, isNaN(daily) ? Infinity : daily);
        }
        return { total: Math.round(total * 100) / 100, parts: [], approximate: true };
    }

    const api = { parseDays, parseClock, parseWindow, validateTariff, findRule, calcCost, estimateCost };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.ParkingTariff = api;
})(typeof window !== "undefined" ? window : this);
