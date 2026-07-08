import DashboardClient from "../components/DashboardClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const testControlsEnabled = process.env["ENABLE_TEST_CONTROLS"] === "true";

  return (
    <DashboardClient testControlsEnabled={testControlsEnabled} />
  );
}
