import ArbitageBoard from "../../components/arbitage/ArbitageBoard";
import AccessGuard from "../../components/arbitage/AccessGuard";

export default function ArbitagePage() {
  return (
    <AccessGuard>
      <div style={{ padding: "14px 0" }}>
        <ArbitageBoard />
      </div>
    </AccessGuard>
  );
}
