import { MatchEntryForm } from "@/components/MatchEntryForm";

export default function InternalMatchDayPage() {
  return (
    <>
      <div className="page-title">
        <div>
          <h1>队内赛录入</h1>
          <p>选择赛季和日期，录入红队、蓝队、白队阵容与赛后文本</p>
        </div>
      </div>
      <div className="section-panel">
        <MatchEntryForm type="INTERNAL" />
      </div>
    </>
  );
}
