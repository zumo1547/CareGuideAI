export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
      <div className="space-y-4">
        <div className="h-12 w-72 rounded-xl bg-cyan-100 soft-pulse" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-28 rounded-2xl bg-slate-200 soft-pulse" />
          <div className="h-28 rounded-2xl bg-slate-200 soft-pulse" />
          <div className="h-28 rounded-2xl bg-slate-200 soft-pulse" />
        </div>
        <div className="h-[340px] rounded-2xl bg-slate-200 soft-pulse" />
      </div>
    </div>
  );
}
