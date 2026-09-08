"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Text } from "@/components/ui/text";
import AccountLoginComponent from "./account-login.component";
import AccessCodeLoginComponent from "./access-code-login.component";

type LoginTab = "account" | "access_code";

const LoginTabsComponent = () => {
  const [activeTab, setActiveTab] = useState<LoginTab>("access_code");
  const baseId = useId();

  const tabId = (t: LoginTab) => `${baseId}-tab-${t}`;
  const panelId = (t: LoginTab) => `${baseId}-panel-${t}`;

  return (
    <main
      className="flex min-h-dvh flex-col justify-center bg-surface-0 px-5"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 2rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)",
      }}
    >
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image
            src="/icons/logo.png"
            alt=""
            width={44}
            height={44}
            style={{ height: "auto" }}
            priority
          />
          <div>
            <h1 className="text-2xl font-semibold text-ink">Scanner</h1>
            <Text variant="p3" color="muted" className="mt-1">
              Sign in to your assigned entrance
            </Text>
          </div>
        </div>

        {/* Surface panel rather than a bordered card with a five-layer glow.
            On a dark ground, depth comes from surface lightness — a heavy
            shadow is invisible and the border was pure decoration. */}
        <div className="rounded-2xl border border-line bg-surface-1 p-5">
          <div
            role="tablist"
            aria-label="Sign-in method"
            className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1"
          >
            <TabButton
              id={tabId("access_code")}
              controls={panelId("access_code")}
              selected={activeTab === "access_code"}
              onSelect={() => setActiveTab("access_code")}
            >
              Access code
            </TabButton>
            <TabButton
              id={tabId("account")}
              controls={panelId("account")}
              selected={activeTab === "account"}
              onSelect={() => setActiveTab("account")}
            >
              Account
            </TabButton>
          </div>

          <div
            role="tabpanel"
            id={panelId(activeTab)}
            aria-labelledby={tabId(activeTab)}
          >
            {activeTab === "account" ? (
              <AccountLoginComponent />
            ) : (
              <AccessCodeLoginComponent />
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4 text-ink-faint" aria-hidden="true" />
          {/* Was 10px. Nothing in this app goes below 11px. */}
          <Text variant="p4" color="muted">
            Every scan is validated in real time.
          </Text>
        </div>
      </div>
    </main>
  );
};

function TabButton({
  id,
  controls,
  selected,
  onSelect,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "min-h-11 rounded-xl px-4 text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink",
        selected
          ? "bg-brand text-white"
          : "bg-transparent text-ink-muted active:bg-line-soft"
      )}
    >
      {children}
    </button>
  );
}

export default LoginTabsComponent;
