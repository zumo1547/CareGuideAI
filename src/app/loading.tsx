export default function RootLoading() {
  return (
    <div className="min-h-screen bg-[linear-gradient(140deg,#e0f2fe_0%,#ecfeff_38%,#f8fafc_70%,#ffffff_100%)]">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 md:px-8 md:py-20">
        <div className="h-12 w-44 rounded-xl bg-cyan-100 soft-pulse" />
        <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="h-10 w-4/5 rounded-xl bg-slate-200 soft-pulse" />
            <div className="h-10 w-3/5 rounded-xl bg-slate-200 soft-pulse" />
            <div className="h-5 w-full rounded-lg bg-slate-200 soft-pulse" />
            <div className="h-5 w-11/12 rounded-lg bg-slate-200 soft-pulse" />
            <div className="flex gap-3 pt-2">
              <div className="h-10 w-32 rounded-full bg-cyan-200 soft-pulse" />
              <div className="h-10 w-28 rounded-full bg-slate-200 soft-pulse" />
            </div>
          </div>
          <div className="rounded-2xl bg-slate-900/95 p-5">
            <div className="h-20 rounded-xl bg-white/10 soft-pulse" />
            <div className="mt-4 h-20 rounded-xl bg-white/10 soft-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
