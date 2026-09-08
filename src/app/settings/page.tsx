import SettingsPanelComponent from "@/components/settings/settings-panel.component";
import { SessionGate } from "@/components/ui/session-gate";

export default function SettingsPage() {
  return (
    <SessionGate>
      <SettingsPanelComponent />
    </SessionGate>
  );
}
