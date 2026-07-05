"use client";

import { useState } from "react";
import { Alert, App, Button, Input, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { FileSearch, Trash2, Upload } from "lucide-react";
import type { Player } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

type ParsedPlayerRow = {
  key: string;
  name: string;
  exists: boolean;
  existingPlayerId?: string | null;
  existingName?: string | null;
};

type PlayerListParseResponse = {
  parsed: {
    players: {
      name: string;
      exists: boolean;
      existingPlayerId?: string | null;
      existingName?: string | null;
    }[];
  };
  modelName: string;
  usedFallback: boolean;
};

type PlayerBulkCreateResponse = {
  created: Player[];
  skipped: {
    name: string;
    reason: string;
    existingPlayerId?: string;
    existingName?: string;
  }[];
};

const samplePlayers = [
  "宇哥",
  "道长",
  "俊锟",
  "康饼",
  "AD钙",
  "BOBO"
].join("\n");

export function PlayerBulkImport({ onImported }: { onImported: () => Promise<void> | void }) {
  const { message } = App.useApp();
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<ParsedPlayerRow[]>([]);
  const [recognizing, setRecognizing] = useState(false);
  const [importing, setImporting] = useState(false);

  const importableRows = rows.filter((row) => !row.exists && row.name.trim());

  async function recognizePlayers() {
    if (!rawText.trim()) {
      message.warning("请先粘贴球员名单");
      return;
    }

    setRecognizing(true);
    try {
      const result = await requestJson<PlayerListParseResponse>("/api/players/parse", {
        method: "POST",
        body: JSON.stringify({ rawText })
      });
      const nextRows = result.parsed.players.map((player, index) => ({
        key: `${index}-${player.name}`,
        name: player.name,
        exists: player.exists,
        existingPlayerId: player.existingPlayerId,
        existingName: player.existingName
      }));

      setRows(nextRows);
      const newCount = nextRows.filter((row) => !row.exists).length;
      message.success(
        `${result.usedFallback ? "本地规则" : "DeepSeek"} 已识别 ${nextRows.length} 名球员，${newCount} 名可导入`
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "识别球员名单失败");
    } finally {
      setRecognizing(false);
    }
  }

  async function importPlayers() {
    const names = importableRows.map((row) => row.name.trim()).filter(Boolean);
    if (!names.length) {
      message.warning("没有可导入的新球员");
      return;
    }

    setImporting(true);
    try {
      const result = await requestJson<PlayerBulkCreateResponse>("/api/players/bulk", {
        method: "POST",
        body: JSON.stringify({
          players: names.map((name) => ({ name, status: "ACTIVE" }))
        })
      });

      message.success(`已导入 ${result.created.length} 名球员`);
      if (result.skipped.length) {
        message.info(`已跳过 ${result.skipped.length} 名重复球员`);
      }
      setRows([]);
      setRawText("");
      await onImported();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批量导入球员失败");
    } finally {
      setImporting(false);
    }
  }

  function updateName(key: string, name: string) {
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              name,
              exists: false,
              existingPlayerId: null,
              existingName: null
            }
          : row
      )
    );
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  const columns: ColumnsType<ParsedPlayerRow> = [
    {
      title: "球员姓名",
      dataIndex: "name",
      render: (_, row) => (
        <Input value={row.name} onChange={(event) => updateName(row.key, event.target.value)} />
      )
    },
    {
      title: "状态",
      width: 140,
      render: (_, row) =>
        row.exists ? (
          <Tag color="default">已存在{row.existingName ? `：${row.existingName}` : ""}</Tag>
        ) : (
          <Tag color="green">待导入</Tag>
        )
    },
    {
      title: "操作",
      width: 80,
      render: (_, row) => (
        <Button
          aria-label="移除"
          icon={<Trash2 size={16} />}
          onClick={() => removeRow(row.key)}
        />
      )
    }
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <div>
        <h2>批量录入球员</h2>
        <p className="muted">粘贴整队名单后先识别，再确认导入；已存在的球员会自动跳过。</p>
      </div>

      <Input.TextArea
        rows={8}
        value={rawText}
        onChange={(event) => setRawText(event.target.value)}
        placeholder={`每行一个球员，例如：\n${samplePlayers}`}
      />

      <Space wrap>
        <Button icon={<FileSearch size={16} />} loading={recognizing} onClick={recognizePlayers}>
          一键识别球员名单
        </Button>
        <Button
          type="primary"
          icon={<Upload size={16} />}
          loading={importing}
          disabled={!importableRows.length}
          onClick={importPlayers}
        >
          导入新球员
        </Button>
      </Space>

      {rows.length ? (
        <>
          <Alert
            type="info"
            showIcon
            message={`识别到 ${rows.length} 名球员，其中 ${importableRows.length} 名新球员可导入。`}
          />
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={rows}
          />
        </>
      ) : null}
    </Space>
  );
}
