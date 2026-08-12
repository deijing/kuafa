import { useEffect, useMemo, useRef, useState } from "react"
import {
  CirclePlay,
  Download,
  Film,
  Info,
  Loader2,
  Music,
  SlidersHorizontal,
  Upload,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useMaterials } from "@/hooks/use-materials"
import { useNotifications } from "@/hooks/use-notifications"
import {
  createGenerateJob,
  fetchJob,
  uploadBgm,
  type BgmItem,
  type DurationPreference,
  type Job,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { extractRules } from "@/data/extract-rules"

const tones = [
  "bg-blue-400",
  "bg-indigo-400",
  "bg-violet-400",
  "bg-pink-400",
  "bg-rose-400",
] as const

type GeneratorViewProps = {
  onGoLibrary?: () => void
}

export function GeneratorView({ onGoLibrary }: GeneratorViewProps) {
  const { materials, selectedIds, groups, activeGroupId } = useMaterials()
  const selected = useMemo(
    () => materials.filter((m) => selectedIds.includes(m.id)),
    [materials, selectedIds]
  )
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  )

  const [duration, setDuration] = useState<DurationPreference>("mid")
  const [addSubtitles, setAddSubtitles] = useState(true)
  const [addBgm, setAddBgm] = useState(true)
  const [bgmVolume, setBgmVolume] = useState<number>(25)
  const [customBgm, setCustomBgm] = useState<BgmItem | null>(null)
  const [uploadingBgm, setUploadingBgm] = useState(false)
  const bgmFileInputRef = useRef<HTMLInputElement>(null)

  const [rules, setRules] = useState<Record<string, boolean>>(
    Object.fromEntries(extractRules.map((r) => [r.id, r.checked]))
  )
  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { notify } = useNotifications()

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) {
      return
    }
    const timer = window.setInterval(() => {
      void fetchJob(job.id)
        .then((next) => {
          setJob(next)
          if (next.status === "succeeded" || next.status === "failed") {
            setBusy(false)
            if (next.status === "succeeded") {
              notify({
                title: "智能成片完成",
                message: "单切片合成已完成，可以在右侧窗口直接预览及下载！",
                type: "success",
              })
            } else {
              notify({
                title: "智能成片失败",
                message: next.error || "视频渲染遇到异常，请检查配置后重试",
                type: "error",
              })
            }
          }
        })
        .catch(() => {
          /* keep polling */
        })
    }, 800)
    return () => window.clearInterval(timer)
  }, [job, notify])

  async function handleBgmUpload(file: File) {
    setUploadingBgm(true)
    setError(null)
    try {
      const uploaded = await uploadBgm(file)
      setCustomBgm(uploaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传音频失败")
    } finally {
      setUploadingBgm(false)
    }
  }

  async function startGenerate() {
    if (!selectedIds.length) {
      setError("请先在素材库勾选切片")
      return
    }
    setError(null)
    setBusy(true)
    setJob(null)
    try {
      const created = await createGenerateJob({
        material_ids: selectedIds,
        group_id: activeGroupId,
        duration_preference: duration,
        add_captions: addSubtitles,
        add_sfx: addBgm,
        add_subtitles: addSubtitles,
        add_bgm: addBgm,
        bgm_volume: bgmVolume,
        bgm_file: customBgm ? customBgm.filename : null,
        mode: "sell",
        extract_rules: rules,
        title: activeGroup
          ? `${activeGroup.name} · 带货成片`
          : "限时特惠 · 直播带货成片",
      })
      setJob(created)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : "创建任务失败")
    }
  }

  const showProcessing =
    busy || job?.status === "queued" || job?.status === "running"
  const showSuccess = job?.status === "succeeded" && job.output_url
  const showFailed = job?.status === "failed"

  return (
    <div className="flex h-full gap-7">
      {/* Settings Column - Paper Card floating on Canvas */}
      <Card className="flex h-full w-[380px] shrink-0 flex-col overflow-y-auto rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.02),0_10px_15px_-3px_rgba(0,0,0,0.03),0_20px_25px_-5px_rgba(0,0,0,0.02)]">
        <CardHeader className="py-5 px-6 border-b border-[#F3F4F6] dark:border-slate-800">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-[#111827] dark:text-slate-100">
            <SlidersHorizontal className="size-4 text-blue-600" />
            混剪规则设置
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-between p-6">
          <div className="flex flex-col">
            {/* Section 1: 核心内容提取 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-1.5">
                核心内容提取
              </h4>
              <p className="mb-3 text-[13px] text-[#9CA3AF] dark:text-slate-400 leading-relaxed">
                默认用必剪 ASR 整句切割（不切半字），结构：前段介绍商品 → 中后段讲价格/促销。
              </p>
              <div className="flex flex-col gap-1">
                {extractRules.map((rule) => (
                  <label
                    key={rule.id}
                    className="flex cursor-pointer items-center justify-between rounded-xl py-2.5 px-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={rules[rule.id]}
                        onCheckedChange={(v) =>
                          setRules((prev) => ({ ...prev, [rule.id]: Boolean(v) }))
                        }
                        className="rounded-[4px] border-slate-300 dark:border-slate-700 data-checked:bg-blue-600 data-checked:border-blue-600"
                      />
                      <span className="text-sm font-medium text-[#4B5563] dark:text-slate-300">
                        {rule.label}
                      </span>
                    </div>
                    {rule.badge ? (
                      <span className="inline-flex items-center rounded-[4px] bg-[rgba(16,185,129,0.1)] dark:bg-emerald-950/60 px-2 py-0.5 text-[11px] font-medium text-[#059669] dark:text-emerald-400 border border-emerald-500/20">
                        {rule.badge}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section 2: 成片时长偏好 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                成片时长偏好（约）
              </h4>
              <Select
                value={duration}
                onValueChange={(v) => setDuration(v as DurationPreference)}
              >
                <SelectTrigger className="w-full text-xs h-10 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 focus:ring-2 focus:ring-blue-500/20 transition-all">
                  <SelectValue placeholder="选择时长" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="short">抖音短版 (~35秒)</SelectItem>
                    <SelectItem value="mid">标准带货 (~60秒)</SelectItem>
                    <SelectItem value="long">完整讲解 (~90秒)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Divider */}
            <div className="my-5 border-b border-[#F3F4F6] dark:border-slate-800" />

            {/* Section 3: 字幕 / 音乐 / 画幅 */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#111827] dark:text-slate-200 mb-2.5">
                字幕 / 音乐 / 画幅
              </h4>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between py-1 px-1">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                      口播字幕（烧录）
                    </span>
                    <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                      逐段弹出，每段不超过 10 字、不换行
                    </span>
                  </div>
                  <Switch
                    checked={addSubtitles}
                    onCheckedChange={setAddSubtitles}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between py-1 px-1">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-[#111827] dark:text-slate-200">
                        背景音乐
                      </span>
                      <span className="text-[13px] text-[#9CA3AF] dark:text-slate-400">
                        {customBgm ? `音频: ${customBgm.filename}` : "自动匹配热度 BGM 或自定义音频"}
                      </span>
                    </div>
                    <Switch checked={addBgm} onCheckedChange={setAddBgm} />
                  </div>

                  {addBgm ? (
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 transition-all">
                      {/* BGM Upload / Custom File Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="file"
                          ref={bgmFileInputRef}
                          accept="audio/*,video/*,.mp3,.mp4,.wav,.m4a,.aac,.flac,.ogg"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void handleBgmUpload(file)
                            e.target.value = ""
                          }}
                        />

                        {customBgm ? (
                          <div className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-blue-200/80 bg-blue-50/80 px-2.5 py-1.5 dark:border-blue-900/60 dark:bg-blue-950/40">
                            <div className="flex min-w-0 items-center gap-2">
                              <Music className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                              <span className="truncate text-xs font-medium text-blue-700 dark:text-blue-300">
                                {customBgm.filename}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setCustomBgm(null)}
                              className="ml-1 rounded p-0.5 text-slate-400 hover:bg-blue-100 hover:text-slate-600 cursor-pointer dark:hover:bg-blue-900"
                              title="移除自定义音乐"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingBgm}
                            onClick={() => bgmFileInputRef.current?.click()}
                            className="w-full h-8 text-xs font-medium border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[#4B5563] dark:text-slate-200 hover:border-blue-500 hover:text-blue-600 cursor-pointer shadow-2xs"
                          >
                            {uploadingBgm ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin text-blue-600" />
                            ) : (
                              <Upload className="mr-1.5 size-3.5 text-blue-600" />
                            )}
                            {uploadingBgm ? "上传中…" : "上传自定义 BGM"}
                          </Button>
                        )}
                      </div>

                      {/* Stepless Volume Control Slider */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-[#4B5563] dark:text-slate-300">
                            <Volume2 className="size-3.5 text-slate-400" />
                            音乐音量 (无极调节)
                          </span>
                          <span className="font-bold font-mono text-blue-600 dark:text-blue-400">
                            {bgmVolume}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={bgmVolume}
                          onChange={(e) => setBgmVolume(Number(e.target.value))}
                          className="h-1.5 w-full cursor-pointer rounded-lg bg-slate-200 dark:bg-slate-700 accent-blue-600"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3.5 text-[13px] text-[#4B5563] dark:text-slate-300 leading-relaxed flex items-start gap-2.5">
                  <Info className="size-4 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    输出固定 <strong className="text-[#111827] dark:text-slate-100 font-semibold">9:16 · 1080×1920</strong>
                    。配置 DeepSeek 后 AI 主观选句；字幕每段 ≤10 字不换行，并带神奇大字动效。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6">
            {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}

            <Button
              className="h-11 w-full rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium text-sm shadow-[0_4px_14px_0_rgba(37,99,235,0.35)] transition-all active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2"
              disabled={busy || !selectedIds.length}
              onClick={() => void startGenerate()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
              {busy ? "处理中…" : "一键智能成片"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Workspace Column (Right Column - Light Mode Studio) */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {/* Selected Clips Panel */}
        <Card className="flex flex-col border border-black/[0.04] dark:border-slate-800 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)] bg-white dark:bg-slate-900 rounded-2xl">
          <CardHeader className="py-4 px-6 border-b border-[#F3F4F6] dark:border-slate-800 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-[#111827] dark:text-slate-100">
              已选切片
              {activeGroup ? ` · ${activeGroup.name}` : ""} (
              {selected.length})
            </CardTitle>
            <button
              type="button"
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer transition-colors"
              onClick={onGoLibrary}
            >
              去素材库选择
            </button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5 p-5">
            <div className="relative flex items-center overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950 p-4">
              <div className="absolute top-0 bottom-0 left-[20%] z-10 w-0.5 bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.5)]" />
              <div className="flex h-20 min-w-max items-center gap-3">
                {selected.length ? (
                  selected.map((clip, index) => (
                    <div
                      key={clip.id}
                      className={cn(
                        "group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/80 shadow-2xs",
                        tones[index % tones.length]
                      )}
                      title={clip.filename}
                    >
                      {clip.thumb_url ? (
                        <img
                          src={clip.thumb_url}
                          alt=""
                          className="absolute inset-0 size-full object-cover opacity-90"
                        />
                      ) : null}
                      <span className="absolute bottom-1 left-1 rounded bg-[#111827]/80 px-1.5 py-0.5 text-[9px] font-bold font-mono text-white">
                        {index + 1}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center gap-2 py-4 text-xs text-[#9CA3AF]">
                    <Film className="size-4 text-[#9CA3AF]" />
                    <span>尚未选择素材，请先到素材库勾选案例切片。</span>
                  </div>
                )}
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[13px] text-[#9CA3AF]">
              <Info className="size-3.5 text-[#9CA3AF] shrink-0" />
              必剪转写整句拼接：介绍商品 → 讲价格，输出 9:16 抖音成片。
            </p>
          </CardContent>
        </Card>

        {/* Video Player / Light Studio Preview Area */}
        <div className="relative flex min-h-[380px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.04] dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)]">
          {showProcessing ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
              <div className="mb-4 text-4xl font-bold font-mono text-[#111827] dark:text-slate-100 tracking-tight">
                {job?.progress ?? 0}%
              </div>
              <Loader2 className="mb-3 size-8 animate-spin text-blue-600" />
              <p className="text-sm font-medium text-[#111827] dark:text-slate-100">
                {job?.message || "准备中…"}
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                转写切句 → 9:16 拼接 → 字幕/BGM
              </p>
            </div>
          ) : null}

          {showFailed ? (
            <div className="z-10 px-6 text-center">
              <p className="mb-2 text-sm font-semibold text-rose-600">成片失败</p>
              <p className="text-xs text-[#4B5563]">{job?.error}</p>
            </div>
          ) : null}

          {showSuccess ? (
            <div className="absolute inset-0 z-30 flex flex-col bg-slate-950 rounded-2xl overflow-hidden">
              <video
                key={job.output_url}
                src={job.output_url!}
                controls
                className="size-full object-contain"
              />
              <div className="absolute right-4 bottom-4">
                <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg rounded-xl">
                  <a href={`/api/jobs/${job.id}/download`} download>
                    <Download className="mr-1.5 size-3.5" />
                    下载成片
                  </a>
                </Button>
              </div>
            </div>
          ) : null}

          {!showProcessing && !showSuccess && !showFailed ? (
            <div className="z-10 flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="relative mb-5 flex size-20 items-center justify-center rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/70 dark:bg-blue-950/40 shadow-xs">
                <CirclePlay className="size-10 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[#111827] dark:text-slate-100 tracking-tight">
                实时成片预览区
              </h3>
              <p className="text-[13px] text-[#4B5563] dark:text-slate-400 leading-relaxed max-w-[280px]">
                点击左侧 <span className="text-blue-600 dark:text-blue-400 font-medium">「一键智能成片」</span> 按钮，系统将根据所选规则自动生成抖音 9:16 高转化视频
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-full border border-emerald-200/80 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/40 px-4 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                智能引擎已就绪 · 等待触发
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
