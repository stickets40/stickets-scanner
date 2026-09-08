import CameraScannerComponent from "@/components/scanner/camera-scanner.component";
import { SessionGate } from "@/components/ui/session-gate";

export default function ScanPage() {
  return (
    <SessionGate>
      <CameraScannerComponent />
    </SessionGate>
  );
}
