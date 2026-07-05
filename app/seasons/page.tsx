"use client";

import { useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalendarPlus, Save } from "lucide-react";
import type { Season } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";

type SeasonFormValues = {
  name: string;
  startDate: string;
  endDate: string;
  status: "ACTIVE" | "ENDED";
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export default function SeasonsPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<SeasonFormValues>();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  async function load() {
    setLoading(true);
    try {
      setLoadError(undefined);
      setSeasons(await requestJson<Season[]>("/api/seasons"));
    } catch (error) {
      const text = error instanceof Error ? error.message : "加载赛季失败";
      setLoadError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const start = new Date();
    form.setFieldsValue({
      name: `${start.getFullYear()}-${start.getMonth() + 1} 赛季`,
      startDate: toDateInput(start),
      endDate: toDateInput(addMonths(start, 3)),
      status: "ACTIVE"
    });
    void load();
  }, [form]);

  async function createSeason(values: SeasonFormValues) {
    try {
      await requestJson<Season>("/api/seasons", {
        method: "POST",
        body: JSON.stringify(values)
      });
      message.success("已创建赛季");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建赛季失败");
    }
  }

  async function updateStatus(season: Season, status: "ACTIVE" | "ENDED") {
    try {
      await requestJson<Season>(`/api/seasons/${season.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      message.success("已更新赛季状态");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新赛季失败");
    }
  }

  const columns: ColumnsType<Season> = [
    { title: "名称", dataIndex: "name" },
    {
      title: "开始",
      dataIndex: "startDate",
      render: (value: string) => value.slice(0, 10)
    },
    {
      title: "结束",
      dataIndex: "endDate",
      render: (value: string) => value.slice(0, 10)
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (status: Season["status"]) => (
        <Tag color={status === "ACTIVE" ? "green" : "default"}>
          {status === "ACTIVE" ? "进行中" : "已结束"}
        </Tag>
      )
    },
    {
      title: "操作",
      render: (_, season) => (
        <Button
          icon={<Save size={16} />}
          onClick={() => updateStatus(season, season.status === "ACTIVE" ? "ENDED" : "ACTIVE")}
        >
          标记为{season.status === "ACTIVE" ? "已结束" : "进行中"}
        </Button>
      )
    }
  ];

  return (
    <>
      <div className="page-title">
        <div>
          <h1>赛季管理</h1>
          <p>赛季长度由开始日期和结束日期决定，新建时默认填入三个月周期</p>
        </div>
      </div>

      <div className="section-panel">
        {loadError ? (
          <Alert
            type="error"
            showIcon
            message="赛季数据加载失败"
            description={loadError}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Form form={form} layout="vertical" onFinish={createSeason}>
          <div className="form-grid">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="startDate" label="开始日期" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="endDate" label="结束日期" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { label: "进行中", value: "ACTIVE" },
                  { label: "已结束", value: "ENDED" }
                ]}
              />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit" icon={<CalendarPlus size={16} />}>
            创建赛季
          </Button>
        </Form>
      </div>

      <div className="section-panel">
        <Table rowKey="id" loading={loading} columns={columns} dataSource={seasons} />
      </div>
    </>
  );
}
