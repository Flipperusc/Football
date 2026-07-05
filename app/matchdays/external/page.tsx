import { MatchEntryForm } from "@/components/MatchEntryForm";

export default function ExternalMatchDayPage() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>队外赛录入</h1>
          <p>选择赛季和日期，录入出勤名单与赛后文本</p>
        </div>
      </div>
      <div className="section-panel">
        <MatchEntryForm type="EXTERNAL" />
      </div>
    </>
  );
}
