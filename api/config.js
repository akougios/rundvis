// Det frontenden skal vide for at kunne logge ind og betale. Alt heri er offentligt med vilje:
// en anon-nøgle er begrænset af row level security, og en Stripe publishable key kan kun
// starte en betaling, ikke hente penge.
//
// Hentes frem for at stå i index.html, så nøgler kan skiftes i Vercel uden en commit — og så
// det er umuligt ved et uheld at committe den forkerte af de to Supabase-nøgler.

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
    stripeNoegle: process.env.STRIPE_PUBLISHABLE_KEY || "",
    // Så frontenden kan vise den rigtige tilstand frem for at gætte.
    loginAktivt: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    betalingAktivt: Boolean(process.env.STRIPE_PUBLISHABLE_KEY),
  });
}
