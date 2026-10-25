/**
 * Notification copy. Hebrew, because the app is Hebrew-first and users carry
 * no language preference yet; the text is built on the server because a push
 * is shown by Android without the app running.
 */
export const pushMessages = {
  message: (sender: string, preview: string) => ({
    title: `הודעה חדשה מ־${sender}`,
    body: preview.length > 80 ? `${preview.slice(0, 79)}…` : preview,
  }),
  planAssigned: (plan: string) => ({
    title: 'תוכנית אימון חדשה מהמאמן',
    body: `"${plan}" מחכה לך באפליקציה`,
  }),
  invite: (trainer: string) => ({
    title: 'בקשת חיבור ממאמן',
    body: `${trainer} רוצה להתחבר אליך ב־FitAi`,
  }),
  accepted: (client: string) => ({
    title: 'החיבור אושר',
    body: `${client} אישר/ה את החיבור`,
  }),
};
