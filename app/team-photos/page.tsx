"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Switch,
  Table,
  Upload
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import type { TeamPhoto } from "@/lib/client-types";
import { requestJson } from "@/lib/client-types";
import { normalizeImageUrl } from "@/lib/image-url";

type TeamPhotoFormValues = {
  imageUrl?: string;
  caption?: string;
  sortOrder?: number;
  isActive?: boolean;
};

type TeamPhotoDraft = {
  caption?: string;
  sortOrder: number;
  isActive: boolean;
};

function TeamPhotoUpload({
  value,
  onChange
}: {
  value?: string;
  onChange?: (value?: string) => void;
}) {
  const previewUrl = normalizeImageUrl(value);

  return (
    <div className="team-photo-upload-field">
      <Upload.Dragger
        accept="image/*"
        customRequest={(options) => {
          const uploadFile = options.file;
          if (!(uploadFile instanceof File)) {
            options.onError?.(new Error("请选择本地图片文件"));
            return;
          }

          const body = new FormData();
          body.append("file", uploadFile);

          fetch("/api/uploads/team-photo", {
            method: "POST",
            body
          })
            .then(async (response) => {
              if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { message?: string } | null;
                throw new Error(payload?.message ?? "球队风采图片上传失败");
              }
              return response.json() as Promise<{ url: string }>;
            })
            .then((payload) => {
              onChange?.(normalizeImageUrl(payload.url));
              options.onSuccess?.(payload);
            })
            .catch((error) => {
              options.onError?.(
                error instanceof Error ? error : new Error("球队风采图片上传失败")
              );
            });
        }}
        maxCount={1}
        showUploadList={false}
      >
        <div className="team-photo-upload-content">
          {previewUrl ? (
            <img className="team-photo-upload-preview" src={previewUrl} alt="球队风采预览" />
          ) : (
            <span className="team-photo-upload-placeholder">
              <ImagePlus size={30} />
            </span>
          )}
          <div>
            <strong>点击上传或拖入球队照片</strong>
            <span>支持 JPG、PNG、WEBP、GIF，最大 8MB</span>
          </div>
        </div>
      </Upload.Dragger>
      {value ? (
        <Button size="small" style={{ marginTop: 8 }} onClick={() => onChange?.(undefined)}>
          移除图片
        </Button>
      ) : null}
    </div>
  );
}

export default function TeamPhotosPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<TeamPhotoFormValues>();
  const [photos, setPhotos] = useState<TeamPhoto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TeamPhotoDraft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string>();

  async function load() {
    setLoading(true);
    try {
      const rows = await requestJson<TeamPhoto[]>("/api/team-photos?all=1");
      setPhotos(rows);
      setDrafts(
        Object.fromEntries(
          rows.map((photo) => [
            photo.id,
            {
              caption: photo.caption ?? "",
              sortOrder: photo.sortOrder,
              isActive: photo.isActive
            }
          ])
        )
      );
      form.setFieldsValue({
        sortOrder: rows.length + 1,
        isActive: true
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createPhoto(values: TeamPhotoFormValues) {
    await requestJson<TeamPhoto>("/api/team-photos", {
      method: "POST",
      body: JSON.stringify({
        imageUrl: normalizeImageUrl(values.imageUrl),
        caption: values.caption?.trim() || null,
        sortOrder: values.sortOrder ?? photos.length + 1,
        isActive: values.isActive ?? true
      })
    });
    message.success("已保存球队风采照片");
    form.resetFields();
    await load();
  }

  function updateDraft(id: string, patch: Partial<TeamPhotoDraft>) {
    setDrafts((current) => {
      const currentDraft = current[id] ?? {
        caption: "",
        sortOrder: 0,
        isActive: true
      };

      return {
        ...current,
        [id]: {
          ...currentDraft,
          ...patch
        }
      };
    });
  }

  async function savePhoto(photo: TeamPhoto) {
    const draft = drafts[photo.id];
    if (!draft) return;

    setSavingId(photo.id);
    try {
      await requestJson<TeamPhoto>(`/api/team-photos/${photo.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          caption: draft.caption?.trim() || null,
          sortOrder: draft.sortOrder,
          isActive: draft.isActive
        })
      });
      message.success("已更新球队风采照片");
      await load();
    } finally {
      setSavingId(undefined);
    }
  }

  async function deletePhoto(photo: TeamPhoto) {
    await requestJson<{ ok: boolean }>(`/api/team-photos/${photo.id}`, {
      method: "DELETE"
    });
    message.success("已删除球队风采照片");
    await load();
  }

  const columns: ColumnsType<TeamPhoto> = [
    {
      title: "照片",
      width: 140,
      render: (_, photo) => (
        <img className="team-photo-thumb" src={normalizeImageUrl(photo.imageUrl)} alt={photo.caption ?? "球队风采"} />
      )
    },
    {
      title: "展示文案",
      render: (_, photo) => (
        <Input
          value={drafts[photo.id]?.caption ?? ""}
          maxLength={100}
          placeholder="例如：7.5 队内赛合影"
          onChange={(event) => updateDraft(photo.id, { caption: event.target.value })}
        />
      )
    },
    {
      title: "排序",
      width: 120,
      render: (_, photo) => (
        <InputNumber
          value={drafts[photo.id]?.sortOrder ?? 0}
          style={{ width: "100%" }}
          onChange={(value) => updateDraft(photo.id, { sortOrder: Number(value ?? 0) })}
        />
      )
    },
    {
      title: "前台展示",
      width: 120,
      render: (_, photo) => (
        <Switch
          checked={drafts[photo.id]?.isActive ?? true}
          checkedChildren="展示"
          unCheckedChildren="隐藏"
          onChange={(checked) => updateDraft(photo.id, { isActive: checked })}
        />
      )
    },
    {
      title: "操作",
      width: 170,
      render: (_, photo) => (
        <Space>
          <Button
            type="primary"
            icon={<Save size={16} />}
            loading={savingId === photo.id}
            onClick={() => savePhoto(photo)}
          >
            保存
          </Button>
          <Popconfirm title="确定删除这张照片？" onConfirm={() => deletePhoto(photo)}>
            <Button danger icon={<Trash2 size={16} />} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <>
      <div className="page-title">
        <div>
          <h1>球队风采</h1>
          <p>上传球队照片，维护前台右侧“球队风采”栏目展示内容。</p>
        </div>
      </div>

      <div className="section-panel">
        <Form
          form={form}
          layout="vertical"
          onFinish={createPhoto}
          initialValues={{ isActive: true, sortOrder: 1 }}
        >
          <Form.Item name="imageUrl" label="照片" rules={[{ required: true, message: "请先上传照片" }]}>
            <TeamPhotoUpload />
          </Form.Item>
          <div className="form-grid">
            <Form.Item name="caption" label="展示文案">
              <Input maxLength={100} placeholder="例如：灵眸GPU 周末队内赛" />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="isActive" label="前台展示" valuePropName="checked">
              <Switch checkedChildren="展示" unCheckedChildren="隐藏" />
            </Form.Item>
          </div>
          <Button type="primary" htmlType="submit" icon={<ImagePlus size={16} />}>
            新增照片
          </Button>
        </Form>
      </div>

      <div className="section-panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={photos}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 8 }}
        />
      </div>
    </>
  );
}
