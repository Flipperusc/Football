"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal, Segmented } from "antd";
import { ArrowDownAZ, Calculator, Info, ListChecks, ScrollText } from "lucide-react";
import {
  defaultRankingRuleKey,
  defaultRankingRuleScope,
  getRankingRuleGroup,
  rankingRuleGroups,
  type RankingRuleScope
} from "@/lib/ranking-rules";

export function RankingRulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [scope, setScope] = useState<RankingRuleScope>(defaultRankingRuleScope);
  const [activeKey, setActiveKey] = useState(defaultRankingRuleKey);
  const group = useMemo(() => getRankingRuleGroup(scope), [scope]);
  const activeRule = group.rules.find((rule) => rule.key === activeKey) ?? group.rules[0];

  useEffect(() => {
    if (!open) return;
    setScope(defaultRankingRuleScope);
    setActiveKey(defaultRankingRuleKey);
  }, [open]);

  function changeScope(value: string | number) {
    const nextScope = value as RankingRuleScope;
    const nextGroup = getRankingRuleGroup(nextScope);
    setScope(nextScope);
    setActiveKey(nextGroup.rules[0].key);
  }

  return (
    <Modal
      title={<span className="public-rules-modal-title"><ScrollText size={20} />榜单规则</span>}
      open={open}
      footer={null}
      centered
      width={900}
      className="public-rules-modal"
      onCancel={onClose}
      destroyOnClose
    >
      <div className="public-rules-scope">
        <span>数据范围</span>
        <Segmented
          value={scope}
          options={rankingRuleGroups.map((item) => ({ label: item.label, value: item.scope }))}
          onChange={changeScope}
          aria-label="选择榜单规则数据范围"
        />
      </div>

      <div className="public-rules-layout">
        <nav className="public-rules-nav" aria-label={`${group.label}榜单规则`}>
          {group.rules.map((rule) => (
            <button
              key={rule.key}
              type="button"
              className={rule.key === activeRule.key ? "is-active" : ""}
              aria-current={rule.key === activeRule.key ? "page" : undefined}
              onClick={() => setActiveKey(rule.key)}
            >
              {rule.title}
            </button>
          ))}
        </nav>

        <article className="public-rules-content">
          <header>
            <span>{group.label}</span>
            <h3>{activeRule.title}</h3>
            <p>{activeRule.description}</p>
          </header>
          <div className="public-rule-section">
            <Calculator size={18} />
            <div><strong>统计口径</strong><p>{activeRule.calculation}</p></div>
          </div>
          <div className="public-rule-section">
            <ListChecks size={18} />
            <div><strong>入榜条件</strong><p>{activeRule.eligibility}</p></div>
          </div>
          <div className="public-rule-section">
            <ArrowDownAZ size={18} />
            <div><strong>排序与同分规则</strong><p>{activeRule.sorting} {activeRule.tieBreak}</p></div>
          </div>
          <div className="public-rule-section public-rule-notes">
            <Info size={18} />
            <div>
              <strong>补充说明</strong>
              <ul>{activeRule.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            </div>
          </div>
        </article>
      </div>
    </Modal>
  );
}
