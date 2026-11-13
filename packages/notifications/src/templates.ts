export type Language = "en" | "hi";
export const LANGUAGES: { code: Language; label: string }[] = [{ code: "en", label: "English" }, { code: "hi", label: "हिन्दी" }];

export type TemplateName = "APPOINTMENT_CONFIRMED" | "APPOINTMENT_REMINDER" | "FOLLOWUP_REMINDER" | "CARD_EXPIRY" | "REPORT_READY" | "OTP" | "TELE_READY" | "MANUAL";

const T: Record<Exclude<TemplateName, "MANUAL">, Record<Language, string>> = {
  APPOINTMENT_CONFIRMED: {
    en: "{hospital}: Hi {name}, your appointment is booked for {date}, {time}. Token #{token}.",
    hi: "{hospital}: नमस्ते {name}, आपका अपॉइंटमेंट {date}, {time} को बुक हो गया है। टोकन #{token}।",
  },
  APPOINTMENT_REMINDER: {
    en: "{hospital}: Reminder, {name}, your appointment is on {date} at {time}. Token #{token}. Please arrive on time.",
    hi: "{hospital}: याद दिलाना, {name}, आपका अपॉइंटमेंट {date} को {time} बजे है। टोकन #{token}। कृपया समय पर पहुँचें।",
  },
  FOLLOWUP_REMINDER: {
    en: "{hospital}: Hi {name}, the doctor has asked you to come for a follow-up visit on {date}.",
    hi: "{hospital}: नमस्ते {name}, डॉक्टर ने आपको {date} को दोबारा दिखाने के लिए कहा है।",
  },
  CARD_EXPIRY: {
    en: "{hospital}: Hi {name}, your health card {cardNo} plan ends on {date}. Renew at the counter to keep free consultations.",
    hi: "{hospital}: नमस्ते {name}, आपके हेल्थ कार्ड {cardNo} का प्लान {date} को समाप्त हो रहा है। मुफ़्त परामर्श जारी रखने के लिए काउंटर पर नवीनीकरण करें।",
  },
  REPORT_READY: {
    en: "{hospital}: Hi {name}, your lab report {orderNo} is ready. View it in the Swasthya app or collect it at the counter.",
    hi: "{hospital}: नमस्ते {name}, आपकी लैब रिपोर्ट {orderNo} तैयार है। स्वास्थ्य ऐप में देखें या काउंटर से लें।",
  },
  TELE_READY: {
    en: "{hospital}: Hi {name}, Dr {doctor} is ready for your video consultation. Open the Swasthya app, go to Appointments and tap Join.",
    hi: "{hospital}: नमस्ते {name}, डॉ. {doctor} आपके वीडियो परामर्श के लिए तैयार हैं। स्वास्थ्य ऐप खोलें, अपॉइंटमेंट में जाकर Join दबाएँ।",
  },
  OTP: {
    en: "Your Swasthya code is {code}. It is valid for 5 minutes. Do not share it with anyone.",
    hi: "आपका स्वास्थ्य कोड {code} है। यह 5 मिनट तक मान्य है। इसे किसी से साझा न करें।",
  },
};

/** Reminder-type messages respect a patient's opt-out; confirmations, report alerts and OTPs do not. */
export const OPT_OUT_APPLIES: TemplateName[] = ["APPOINTMENT_REMINDER", "FOLLOWUP_REMINDER", "CARD_EXPIRY"];

export function render(template: Exclude<TemplateName, "MANUAL">, language: string, vars: Record<string, string | number>): string {
  const lang: Language = language === "hi" ? "hi" : "en";
  return T[template][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions, lang: string) => d.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", ...opts });
export const fmtDate = (d: Date, lang = "en") => fmt(d, { weekday: "short", day: "numeric", month: "short" }, lang);
export const fmtTime = (d: Date, lang = "en") => fmt(d, { hour: "numeric", minute: "2-digit" }, lang);
