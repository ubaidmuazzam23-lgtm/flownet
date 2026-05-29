// frontend/src/screens/Login.tsx
import { useState } from "react";
import { useSignIn } from "@clerk/clerk-react";

export default function Login() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<"login" | "code">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn.create({ identifier: email, password });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        return;
      }

      const emailFactor = result.supportedFirstFactors?.find(
        (f: any) => f.strategy === "email_code"
      );
      if (emailFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: (emailFactor as any).emailAddressId,
        });
        setStep("code");
      } else {
        setError("Clerk status: " + result.status);
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? "Sign in failed. Check your credentials.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode() {
    if (!isLoaded) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Verification incomplete: " + result.status);
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? "Invalid code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 bg-ink-950 text-ash-100 overflow-hidden grid lg:grid-cols-[1.1fr,1fr]">
      <div className="relative hidden lg:block overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,109,41,0.25), transparent 65%)" }} />
        <div className="absolute -bottom-40 -right-20 w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(114,46,209,0.18), transparent 65%)" }} />
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
          {[80, 160, 240, 320, 400].map((r, i) => (
            <circle key={r} cx="300" cy="420" r={r} fill="none" stroke="rgba(255,109,41,0.18)"
              strokeWidth={i === 0 ? 1.5 : 1} strokeDasharray={i % 2 ? "2 6" : ""} />
          ))}
          <g className="spin-slow" style={{ transformOrigin: "300px 420px" }}>
            <path d="M 300 420 L 300 20 A 400 400 0 0 1 690 380 Z" fill="url(#radar-g)" opacity="0.4" />
            <defs>
              <linearGradient id="radar-g" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#FF6D29" stopOpacity="0" />
                <stop offset="1" stopColor="#FF6D29" stopOpacity="0.5" />
              </linearGradient>
            </defs>
          </g>
          {[[140,300],[220,520],[420,330],[470,560],[200,650],[380,180],[510,420]].map(([x,y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="3" fill="#FF6D29" />
              <circle cx={x} cy={y} r="3" fill="#FF6D29" className="pulse-ring-slow" />
            </g>
          ))}
        </svg>

        <div className="relative h-full flex flex-col p-12">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div>
              <div className="font-display font-semibold text-[18px]">
                FlowNet <span className="text-flame-500">AI</span>
              </div>
              <div className="text-[10px] font-mono text-ash-400 tracking-wider">
                FINANCIAL CRIME INTELLIGENCE
              </div>
            </div>
          </div>
          <div className="mt-auto max-w-[460px]">
            <div className="font-mono text-[10px] tracking-[0.18em] text-flame-500 mb-3">
              SECURE INVESTIGATOR ACCESS
            </div>
            <h1 className="font-display text-4xl font-semibold leading-tight">
              A mission-control console for financial crime.
            </h1>
            <p className="text-ash-300 mt-4 text-[14px] leading-relaxed">
              Trace fund flow across accounts, branches, and channels.
              Detect suspicious behaviour with deep-learning intelligence.
            </p>
          </div>
          <div className="text-[10px] font-mono text-ash-500 tracking-wider mt-8">
            © 2026 FLOWNET AI
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-dots opacity-50" />
        <div className="relative w-full max-w-[420px]">
          <div className="lg:hidden mb-6 flex items-center gap-2">
            <BrandMark />
            <span className="font-display font-semibold">FlowNet AI</span>
          </div>

          {step === "login" && (
            <div className="glass-strong rounded-2xl p-7 hud-corners">
              <div className="font-mono text-[10px] tracking-[0.18em] text-flame-500 mb-2">
                STEP 01 / 02 · SIGN IN
              </div>
              <h2 className="font-display text-2xl font-semibold">Welcome to FlowNet AI</h2>
              <p className="text-ash-400 text-[13px] mt-1">Use your investigator credentials.</p>

              <div className="mt-6 space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-ash-400 tracking-wider">EMAIL</label>
                  <div className="mt-1 flex items-center gap-2 border border-line rounded-lg bg-ink-800/60 px-3 h-11 focus-within:border-flame-500">
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@bank.in"
                      className="bg-transparent flex-1 outline-none text-[13.5px] text-ash-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-ash-400 tracking-wider">PASSWORD</label>
                  <div className="mt-1 flex items-center gap-2 border border-line rounded-lg bg-ink-800/60 px-3 h-11 focus-within:border-flame-500">
                    <input type={showPw ? "text" : "password"} value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                      placeholder="............"
                      className="bg-transparent flex-1 outline-none text-[13.5px] font-mono tracking-widest text-ash-100" />
                    <button onClick={() => setShowPw((s) => !s)}
                      className="text-ash-500 text-[11px] font-mono hover:text-ash-300">
                      {showPw ? "HIDE" : "SHOW"}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mt-4 text-[12px] text-danger-500 bg-danger-500/10 border border-danger-500/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button onClick={handleSignIn} disabled={busy || !isLoaded}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-flame-500 hover:bg-flame-600 disabled:opacity-60 text-white font-medium h-11 rounded-lg shadow-[0_10px_30px_rgba(255,109,41,0.4)]">
                {busy ? "Signing in..." : "Continue"}
              </button>

              <div className="mt-5 text-[11px] font-mono text-ash-500 tracking-wider text-center">
                SESSIONS ARE LOGGED
              </div>
            </div>
          )}

          {step === "code" && (
            <div className="glass-strong rounded-2xl p-7 hud-corners">
              <button onClick={() => { setStep("login"); setError(null); }}
                className="text-[12px] text-ash-400 hover:text-ash-100">&larr; Back</button>
              <div className="font-mono text-[10px] tracking-[0.18em] text-flame-500 mb-2 mt-2">
                STEP 02 / 02 · VERIFY
              </div>
              <h2 className="font-display text-2xl font-semibold">Check your email</h2>
              <p className="text-ash-400 text-[13px] mt-1">
                We sent a verification code to <span className="text-flame-500">{email}</span>.
              </p>

              <div className="mt-6">
                <label className="text-[10px] font-mono text-ash-400 tracking-wider">VERIFICATION CODE</label>
                <div className="mt-1 flex items-center gap-2 border border-line rounded-lg bg-ink-800/60 px-3 h-12 focus-within:border-flame-500">
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                    placeholder="000000" inputMode="numeric"
                    className="bg-transparent flex-1 outline-none text-[20px] font-mono tracking-[0.4em] text-center text-ash-100" />
                </div>
              </div>

              {error && (
                <div className="mt-4 text-[12px] text-danger-500 bg-danger-500/10 border border-danger-500/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button onClick={handleVerifyCode} disabled={busy || code.length < 6}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-flame-500 hover:bg-flame-600 disabled:opacity-60 text-white font-medium h-11 rounded-lg shadow-[0_10px_30px_rgba(255,109,41,0.4)]">
                {busy ? "Verifying..." : "Enter Console"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <svg width={26} height={26} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="flownet-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB28A" />
          <stop offset="0.6" stopColor="#FF6D29" />
          <stop offset="1" stopColor="#B23F08" />
        </linearGradient>
      </defs>
      <path d="M16 2 L28 7 V16 C28 23 22 28 16 30 C10 28 4 23 4 16 V7 Z"
        fill="url(#flownet-g)" opacity="0.18" stroke="url(#flownet-g)" strokeWidth="1.5" />
      <path d="M16 9 L22 12 V17 C22 20.5 19 23 16 24 C13 23 10 20.5 10 17 V12 Z"
        fill="none" stroke="url(#flownet-g)" strokeWidth="1.5" />
      <circle cx="16" cy="15" r="1.6" fill="#FF6D29" />
    </svg>
  );
}