interface RouteLoaderProps {
  variant?: "landing" | "app";
}

export const RouteLoader = ({ variant = "landing" }: RouteLoaderProps) => {
  if (variant === "app") {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <div className="loading-surface space-y-4 p-4 md:p-5">
          <div className="loading-bar" />
          <div className="loading-block h-10 w-56 rounded-xl" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="loading-block h-24 rounded-2xl" />
            <div className="loading-block h-24 rounded-2xl" />
            <div className="loading-block h-24 rounded-2xl" />
          </div>
          <div className="loading-block h-[300px] rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(140deg,#e0f2fe_0%,#ecfeff_38%,#f8fafc_70%,#ffffff_100%)]">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 md:px-8 md:py-20">
        <div className="loading-surface space-y-6 p-6 md:p-8">
          <div className="loading-bar" />
          <div className="loading-block h-12 w-44 rounded-xl" />
          <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="loading-block h-10 w-4/5 rounded-xl" />
              <div className="loading-block h-10 w-3/5 rounded-xl" />
              <div className="loading-block h-5 w-full rounded-lg" />
              <div className="loading-block h-5 w-11/12 rounded-lg" />
              <div className="flex gap-3 pt-2">
                <div className="loading-block h-10 w-32 rounded-full" />
                <div className="loading-block h-10 w-28 rounded-full" />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800/30 bg-slate-900/95 p-5">
              <div className="loading-block h-20 rounded-xl bg-white/10" />
              <div className="loading-block mt-4 h-20 rounded-xl bg-white/10" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
