"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { Text } from "@/components/ui/text";
import { ShieldCheck } from "lucide-react";
import AccountLoginComponent from "./account-login.component";
import AccessCodeLoginComponent from "./access-code-login.component";

type LoginTab = "account" | "access_code";

const LoginTabsComponent = () => {
  const [activeTab, setActiveTab] = useState<LoginTab>("access_code");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background-light px-6">
      <div className="w-full max-w-sm">
        {/* Login Card */}
        <div className="rounded-3xl border-2 border-primary bg-white px-8 py-6 shadow-[0_4px_6px_rgba(0,0,0,0.04),0_10px_15px_rgba(0,0,0,0.03),0_20px_25px_rgba(0,0,0,0.03),0_2px_4px_rgba(255,69,0,0.06),0_0px_40px_rgba(255,69,0,0.04)]">
          {/* Logo / Title - Horizontal layout */}
          <div className="mb-2 flex items-center justify-center gap-3">
            <Image
              src="/icons/logo.png"
              alt="Stickets"
              width={36}
              height={36}
            />
            <Text variant="h3">Scanner Login</Text>
          </div>
          <Text variant="p3" color="secondary" className="mb-6 text-center">
            Access your assigned event scanner
          </Text>

          {/* Tab Switcher - Pill Style */}
          <div className="mb-6 flex items-center justify-center gap-2">
            <button
              onClick={() => setActiveTab("account")}
              className={cn(
                "rounded-full px-5 py-2 text-sm font-medium transition-all duration-200",
                activeTab === "account"
                  ? "bg-primary text-white shadow-sm"
                  : "border border-border bg-white text-text-primary hover:bg-background-light"
              )}
            >
              Account Login
            </button>
            <button
              onClick={() => setActiveTab("access_code")}
              className={cn(
                "rounded-full px-5 py-2 text-sm font-medium transition-all duration-200",
                activeTab === "access_code"
                  ? "bg-primary text-white shadow-sm"
                  : "border border-border bg-white text-text-primary hover:bg-background-light"
              )}
            >
              Access Code
            </button>
          </div>

          {/* Forms */}
          {activeTab === "account" ? (
            <AccountLoginComponent />
          ) : (
            <AccessCodeLoginComponent />
          )}

          {/* Footer note */}
          <div className="mt-5 flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-text-secondary" />
            <Text variant="p4" color="secondary">
              All scans are securely validated in real time.
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginTabsComponent;
