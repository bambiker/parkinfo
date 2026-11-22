// Google Apps Script: מפעיל כל 30 דקות את הפעולה "איסוף תפוסת חניונים" ב-GitHub.
// GitHub עצמו מריץ פעולות מתוזמנות רק כמה פעמים ביום, ולכן הטריגר מגיע מכאן.
// הוראות התקנה: README.md, בסעיף "סטטוס חי ותפוסה של חניוני אחוזות החוף".

const OWNER = "bambiker";
const REPO = "parkinfo";
const WORKFLOW = "collect-occupancy.yml";

// רץ מהטריגר כל 30 דקות
function triggerOccupancy() {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) throw new Error("חסר GITHUB_TOKEN במאפייני הסקריפט (הגדרות הפרויקט > מאפייני סקריפט)");
  const res = UrlFetchApp.fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      payload: JSON.stringify({ ref: "main" }),
      muteHttpExceptions: true
    });
  const code = res.getResponseCode();
  if (code !== 204) {
    // 401: הטוקן לא נכון או שפג תוקפו. 403/404: לטוקן אין הרשאת Actions לריפו.
    throw new Error("GitHub החזיר " + code + ": " + res.getContentText());
  }
}

// להריץ פעם אחת ביד: יוצר את הטריגר של כל 30 דקות (ומוחק טריגר קודם, אם יש)
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "triggerOccupancy")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("triggerOccupancy").timeBased().everyMinutes(30).create();
  triggerOccupancy(); // בדיקה מיידית: אם יש בעיה בטוקן, תופיע שגיאה עכשיו
}
