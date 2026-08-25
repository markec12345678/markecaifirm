// v9.65: Instrumentation hook — Next.js native startup hook.
//
// Ta datoteka se zažene OB STARTU serverja (enkrat, ne na vsak request).
// Uporablja se za:
// 1. Inicializacijo internega schedulerja (setInterval) — NE rabi zunanjega cron-a
// 2. Setup logginga, monitoringa, itd.
//
// Navdih: Next.js 14+ instrumentation.ts hook (uradna funkcija Next.js).
// Vir: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// LOCAL-FIRST prednost:
// - Ker aplikacija teče kot stalni Node.js proces (ne serverless),
//   setInterval deluje zanesljivo.
// - Uporabnik NE rabi registracije na cron-job.org ali podobnem servisu.
// - Samodejno se zažene ko aplikacija starta.
// - Ustavi se ko aplikacija se ustavi.
//
// Fallback:
// - Če interni scheduler izpade (npr. server crash), ga lahko uporabnik
//   ročno ponovno zažene v Nastavitve → Scheduler.
// - Zunanji cron je še vedno podprt kot optional backup.

export async function register() {
  // Samo na server-side (ne v edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startInternalScheduler } = await import('@/lib/scheduler/internal-scheduler');
    await startInternalScheduler();
  }
}
