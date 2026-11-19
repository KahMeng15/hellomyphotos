<script lang="ts">
  import { onMount } from 'svelte';
  import { API_BASE } from '$lib/api/media';
  import {
    ChevronLeft, ShieldAlert, ShieldCheck, Save, Plus, Copy, Trash2,
    Type, Image, Sliders, Eye, Download, RefreshCw, Check, Camera
  } from '@lucide/svelte';
  import { toast } from '$lib/stores/toast';

  interface SampleImage {
    id: string;
    file_name: string;
    folder_path: string;
    img_width: number;
    img_height: number;
    captured_at?: string;
    camera_make?: string;
    camera_model?: string;
    lens_model?: string;
  }

  interface WatermarkTemplate {
    id: string;
    name: string;
    description?: string;
    is_default: boolean;
    type: 'text' | 'image';
    text_content: string;
    font_family: string;
    font_weight: string;
    font_style: string;
    font_color: string;
    text_align: 'left' | 'center' | 'right';
    letter_spacing: number;
    line_spacing: number;
    image_path?: string | null;
    shadow_enabled: boolean;
    shadow_color: string;
    shadow_opacity: number;
    shadow_radius: number;
    shadow_offset_x: number;
    shadow_offset_y: number;
    bg_box_enabled: boolean;
    bg_box_color: string;
    bg_box_opacity: number;
    bg_box_padding_x: number;
    bg_box_padding_y: number;
    bg_box_border_radius: number;
    anchor: 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    inset_x: number;
    inset_y: number;
    scale_mode: 'proportional_long_edge' | 'proportional_short_edge' | 'fit' | 'fill' | 'exact_px';
    scale_value: number;
    rotation: number;
    opacity: number;
    is_tiled: boolean;
    allow_hd_download: boolean;
    restricted_tier: '1080p' | '500px';
    apply_to_previews: boolean;
    apply_to_downloads: boolean;
  }

  let templates = $state<WatermarkTemplate[]>([]);
  let selectedId = $state<string>('');
  let activeTemplate = $state<WatermarkTemplate | null>(null);

  let globalEnforced = $state(false);
  let globalTemplateId = $state<string | null>(null);

  let loading = $state(true);
  let isSaving = $state(false);
  let isRegenerating = $state(false);
  let isUploadingLogo = $state(false);

  let previewSampleType = $state<'landscape' | 'portrait' | 'dark' | 'light'>('landscape');
  let isServerRendering = $state(false);
  let serverPreviewUrl = $state<string | null>(null);

  let sampleImages = $state<SampleImage[]>([]);
  let selectedSampleIndex = $state<number>(0);
  let selectedSampleImage = $derived(sampleImages[selectedSampleIndex] || null);
  let useRealPhoto = $state<boolean>(true);

  const anchorGrid = [
    ['top-left', 'top-center', 'top-right'],
    ['middle-left', 'center', 'middle-right'],
    ['bottom-left', 'bottom-center', 'bottom-right']
  ] as const;

  const fontOptions = [
    { label: 'Instrument Sans (Default)', value: 'Instrument Sans' },
    { label: 'Cabinet Grotesk (Bold Display)', value: 'Cabinet Grotesk' },
    { label: 'Playfair Display (Classic Serif)', value: 'Playfair Display' },
    { label: 'Great Vibes (Calligraphy Script)', value: 'Great Vibes' },
    { label: 'Monospace (Technical)', value: 'monospace' }
  ];

  const fontWeightOptions = [
    { label: 'Light (300)', value: '300' },
    { label: 'Regular (400)', value: 'normal' },
    { label: 'Medium (500)', value: '500' },
    { label: 'Semi-Bold (600)', value: '600' },
    { label: 'Bold (700)', value: 'bold' },
    { label: 'Extra Bold (800)', value: '800' }
  ];

  const fontStyleOptions = [
    { label: 'Normal', value: 'normal' },
    { label: 'Italic', value: 'italic' }
  ];

  async function loadData() {
    loading = true;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/watermark/templates`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        templates = data.templates || [];
        globalEnforced = Boolean(data.enforceGlobal);
        globalTemplateId = data.globalTemplateId || null;

        if (templates.length > 0) {
          const def = templates.find(t => t.is_default) || templates[0];
          selectedId = def.id;
          activeTemplate = JSON.parse(JSON.stringify(def));
        } else {
          createNewTemplate();
        }
      } else {
        toast.error('Failed to load watermark templates');
      }

      // Fetch sample media photos from library for live preview
      try {
        const samplesRes = await fetch(`${API_BASE}/api/admin/watermark/sample-images`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (samplesRes.ok) {
          const sData = await samplesRes.json();
          sampleImages = sData.images || [];
          if (sampleImages.length > 0 && selectedSampleIndex >= sampleImages.length) {
            selectedSampleIndex = 0;
          }
        }
      } catch {}
    } catch (e: any) {
      toast.error(e.message || 'Error fetching templates');
    } finally {
      loading = false;
    }
  }

  function selectTemplate(id: string) {
    selectedId = id;
    const found = templates.find(t => t.id === id);
    if (found) {
      activeTemplate = JSON.parse(JSON.stringify(found));
      serverPreviewUrl = null;
    }
  }

  function createNewTemplate() {
    const newTpl: WatermarkTemplate = {
      id: '',
      name: `Preset ${templates.length + 1}`,
      description: '',
      is_default: templates.length === 0,
      type: 'text',
      text_content: 'hellomyphotos',
      font_family: 'Instrument Sans',
      font_weight: 'bold',
      font_style: 'normal',
      font_color: '#ffffff',
      text_align: 'center',
      letter_spacing: 0,
      line_spacing: 1.25,
      shadow_enabled: true,
      shadow_color: '#000000',
      shadow_opacity: 0.75,
      shadow_radius: 4,
      shadow_offset_x: 2,
      shadow_offset_y: 2,
      bg_box_enabled: false,
      bg_box_color: '#000000',
      bg_box_opacity: 0.5,
      bg_box_padding_x: 14,
      bg_box_padding_y: 10,
      bg_box_border_radius: 6,
      anchor: 'bottom-right',
      inset_x: 3,
      inset_y: 3,
      scale_mode: 'proportional_long_edge',
      scale_value: 15,
      rotation: 0,
      opacity: 0.85,
      is_tiled: false,
      allow_hd_download: false,
      restricted_tier: '1080p',
      apply_to_previews: true,
      apply_to_downloads: true
    };
    activeTemplate = newTpl;
    selectedId = '';
    serverPreviewUrl = null;
  }

  function duplicateTemplate() {
    if (!activeTemplate) return;
    const cloned: WatermarkTemplate = JSON.parse(JSON.stringify(activeTemplate));
    cloned.id = '';
    cloned.name = `${cloned.name} (Copy)`;
    cloned.is_default = false;
    activeTemplate = cloned;
    selectedId = '';
  }

  async function saveActiveTemplate() {
    if (!activeTemplate) return;
    isSaving = true;

    try {
      const token = localStorage.getItem('token');
      const method = activeTemplate.id ? 'PUT' : 'POST';
      const url = activeTemplate.id
        ? `${API_BASE}/api/admin/watermark/templates/${activeTemplate.id}`
        : `${API_BASE}/api/admin/watermark/templates`;

      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(activeTemplate)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save preset');
      }

      const saved = await res.json();
      toast.success('Watermark preset saved & photos updating in background!');

      await loadData();
      selectedId = saved.id;
      activeTemplate = JSON.parse(JSON.stringify(saved));
    } catch (e: any) {
      toast.error(e.message || 'Error saving template');
    } finally {
      isSaving = false;
    }
  }

  async function regenerateActiveTemplate() {
    if (!activeTemplate?.id || isRegenerating) return;
    isRegenerating = true;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/watermark/templates/${activeTemplate.id}/regenerate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Regeneration failed');
      toast.success(`Regenerated ${data.regenerated} photo(s) across active shares (purged ${data.purged} cached)`);
    } catch (e: any) {
      toast.error(e.message || 'Error regenerating photos');
    } finally {
      isRegenerating = false;
    }
  }

  async function deleteActiveTemplate() {
    if (!activeTemplate?.id) return;
    if (!confirm(`Are you sure you want to delete preset "${activeTemplate.name}"?`)) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/watermark/templates/${activeTemplate.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('Preset deleted');
        await loadData();
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete template');
    }
  }

  async function saveGlobalEnforcement() {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          watermarkEnforceGlobal: globalEnforced,
          watermarkGlobalTemplateId: globalTemplateId
        })
      });
      if (res.ok) {
        toast.success(globalEnforced ? 'Global watermark enforcement activated' : 'Global enforcement disabled');
      }
    } catch {
      toast.error('Failed to update enforcement settings');
    }
  }

  async function handleLogoUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !activeTemplate) return;

    const file = input.files[0];
    const formData = new FormData();
    formData.append('logo', file);

    isUploadingLogo = true;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/watermark/upload-logo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) throw new Error('Logo upload failed');
      const data = await res.json();
      activeTemplate.image_path = data.imagePath;
      activeTemplate.type = 'image';
      toast.success('Watermark logo uploaded');
    } catch (err: any) {
      toast.error(err.message || 'Error uploading logo');
    } finally {
      isUploadingLogo = false;
    }
  }

  async function triggerServerPreview() {
    if (!activeTemplate) return;
    isServerRendering = true;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/api/admin/watermark/preview`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          template: activeTemplate,
          sampleType: previewSampleType,
          mediaId: useRealPhoto && selectedSampleImage ? selectedSampleImage.id : undefined
        })
      });
      if (res.ok) {
        const blob = await res.blob();
        if (serverPreviewUrl) URL.revokeObjectURL(serverPreviewUrl);
        serverPreviewUrl = URL.createObjectURL(blob);
      }
    } catch {} finally {
      isServerRendering = false;
    }
  }

  let lastTemplateSnapshot = '';
  $effect(() => {
    if (!activeTemplate) return;
    const snap = JSON.stringify(activeTemplate);
    if (lastTemplateSnapshot && snap !== lastTemplateSnapshot) {
      if (serverPreviewUrl) {
        URL.revokeObjectURL(serverPreviewUrl);
        serverPreviewUrl = null;
      }
    }
    lastTemplateSnapshot = snap;
  });

  function insertToken(token: string) {
    if (!activeTemplate) return;
    activeTemplate.text_content = (activeTemplate.text_content || '') + ' ' + token;
  }

  // --- Exact Text Measurement Helper ---
  function measureCanvasTextWidth(
    lines: string[],
    fontFamily: string,
    fontWeight: string,
    fontStyle: string,
    fontSize: number,
    letterSpacing: number
  ): number {
    let maxW = 0;
    if (typeof document !== 'undefined') {
      try {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.font = `${fontStyle || 'normal'} ${fontWeight || 'bold'} ${fontSize}px "${fontFamily}", -apple-system, sans-serif`;
          for (const line of lines) {
            let w = ctx.measureText(line).width;
            if (letterSpacing) {
              w += Math.max(0, line.length - 1) * letterSpacing;
            }
            if (w > maxW) maxW = w;
          }
        }
      } catch {}
    }
    if (!maxW) {
      const maxChars = Math.max(...lines.map(l => l.length), 1);
      maxW = maxChars * (fontSize * 0.6) + (maxChars * letterSpacing);
    }
    return Math.ceil(maxW);
  }

  // --- Dynamic Token Substitution for Preview ---
  let previewTextLines = $derived.by(() => {
    if (!activeTemplate) return [];
    let text = activeTemplate.text_content || 'hellomyphotos';
    const year = (useRealPhoto && selectedSampleImage?.captured_at)
      ? new Date(selectedSampleImage.captured_at).getFullYear().toString()
      : '2026';
    const filename = (useRealPhoto && selectedSampleImage?.file_name) || 'DSC_0842.JPG';
    const camera = (useRealPhoto && selectedSampleImage)
      ? [selectedSampleImage.camera_make, selectedSampleImage.camera_model].filter(Boolean).join(' ') || 'Sony A7 IV'
      : 'Sony A7 IV';
    const lens = (useRealPhoto && selectedSampleImage?.lens_model) || 'FE 24-70mm GM';

    text = text.replace(/{year}/g, year)
               .replace(/{copyright}/g, 'hellomyphotos')
               .replace(/{filename}/g, filename)
               .replace(/{camera}/g, camera)
               .replace(/{lens}/g, lens);
    return text.split('\n');
  });

  // --- Fully Contained Vector SVG Layout Calculation ---
  let previewLayout = $derived.by(() => {
    if (!activeTemplate) return null;
    let canvasW = 1200;
    let canvasH = 800;

    if (useRealPhoto && selectedSampleImage && selectedSampleImage.img_width && selectedSampleImage.img_height) {
      canvasW = selectedSampleImage.img_width;
      canvasH = selectedSampleImage.img_height;
    } else {
      const isPortrait = previewSampleType === 'portrait';
      canvasW = isPortrait ? 800 : 1200;
      canvasH = isPortrait ? 1200 : 800;
    }

    const lines = previewTextLines;
    const longEdge = Math.max(canvasW, canvasH);
    const shortEdge = Math.min(canvasW, canvasH);

    const insetXPx = Math.round(canvasW * ((activeTemplate.inset_x ?? 3) / 100));
    const insetYPx = Math.round(canvasH * ((activeTemplate.inset_y ?? 3) / 100));

    const padX = activeTemplate.bg_box_enabled ? Math.max(Number(activeTemplate.bg_box_padding_x) || 14, 2) : 0;
    const padY = activeTemplate.bg_box_enabled ? Math.max(Number(activeTemplate.bg_box_padding_y) || 10, 2) : 0;

    // Available bounds inside photo canvas
    const maxAllowedW = Math.max(80, canvasW - (insetXPx * 2) - (padX * 2) - 16);
    const maxAllowedH = Math.max(60, canvasH - (insetYPx * 2) - (padY * 2) - 16);

    const fontFamily = activeTemplate.font_family || 'Instrument Sans';
    const fontWeight = activeTemplate.font_weight || 'bold';
    const fontStyle = activeTemplate.font_style || 'normal';
    const letterSpacing = Number(activeTemplate.letter_spacing) || 0;

    // Font size determination based on scale_mode and actual image dimensions
    let fontSize = 32;
    const scaleVal = activeTemplate.scale_value != null ? Number(activeTemplate.scale_value) : 15;
    if (activeTemplate.scale_mode === 'exact_px') {
      fontSize = Math.round(scaleVal || 28);
    } else if (activeTemplate.scale_mode === 'proportional_short_edge') {
      fontSize = Math.round(shortEdge * (scaleVal / 350));
    } else if (activeTemplate.scale_mode === 'fit') {
      // In fit mode, scale font to fit image boundaries if text is long
      const refW = measureCanvasTextWidth(lines, fontFamily, fontWeight, fontStyle, 40, letterSpacing);
      const fitSize = Math.round((maxAllowedW / (refW || 100)) * 40);
      const propSize = Math.round(longEdge * (scaleVal / 500));
      fontSize = Math.min(fitSize, propSize);
    } else {
      // proportional_long_edge (Standard)
      fontSize = Math.round(longEdge * (scaleVal / 500));
    }

    fontSize = Math.max(4, Math.min(fontSize, Math.round(canvasH * 0.4)));

    let textWidth = measureCanvasTextWidth(lines, fontFamily, fontWeight, fontStyle, fontSize, letterSpacing);
    let lineHeight = Math.round(fontSize * (activeTemplate.line_spacing || 1.25));
    let textHeight = lines.length * lineHeight;

    // Clamp fontSize only if multiline or very long text would exceed canvas boundaries
    while (textWidth > maxAllowedW && fontSize > 4) {
      fontSize -= 1;
      textWidth = measureCanvasTextWidth(lines, fontFamily, fontWeight, fontStyle, fontSize, letterSpacing);
      lineHeight = Math.round(fontSize * (activeTemplate.line_spacing || 1.25));
      textHeight = lines.length * lineHeight;
    }

    const boxW = textWidth + padX * 2;
    const boxH = textHeight + padY * 2;

    const rawRot = Number(activeTemplate.rotation) || 0;
    const rot = ((rawRot % 360) + 360) % 360;

    let visualW = boxW;
    let visualH = boxH;
    if (rot === 90 || rot === 270) {
      visualW = boxH;
      visualH = boxW;
    }

    let visualX = 0;
    let visualY = 0;
    const anchor = activeTemplate.anchor || 'bottom-right';

    if (anchor.includes('left')) {
      visualX = insetXPx;
    } else if (anchor.includes('right')) {
      visualX = canvasW - insetXPx - visualW;
    } else {
      visualX = Math.round((canvasW - visualW) / 2);
    }

    if (anchor.includes('top')) {
      visualY = insetYPx;
    } else if (anchor.includes('bottom')) {
      visualY = canvasH - insetYPx - visualH;
    } else {
      visualY = Math.round((canvasH - visualH) / 2);
    }

    // Mathematical boundary clamping: rotated visual box must stay 100% inside canvas
    visualX = Math.max(0, Math.min(visualX, canvasW - visualW));
    visualY = Math.max(0, Math.min(visualY, canvasH - visualH));

    let transform = '';
    if (rot === 90) {
      transform = `translate(${visualX + boxH}, ${visualY}) rotate(90)`;
    } else if (rot === 180) {
      transform = `translate(${visualX + boxW}, ${visualY + boxH}) rotate(180)`;
    } else if (rot === 270) {
      transform = `translate(${visualX}, ${visualY + boxW}) rotate(270)`;
    } else {
      transform = `translate(${visualX}, ${visualY})`;
    }

    let textAnchor = 'start';
    let textX = padX;
    if (activeTemplate.text_align === 'center') {
      textAnchor = 'middle';
      textX = padX + Math.round(textWidth / 2);
    } else if (activeTemplate.text_align === 'right') {
      textAnchor = 'end';
      textX = padX + textWidth;
    }

    return {
      canvasW,
      canvasH,
      boxW,
      boxH,
      visualW,
      visualH,
      visualX,
      visualY,
      transform,
      textX,
      padY,
      textAnchor,
      fontSize,
      lineHeight
    };
  });

  onMount(() => {
    loadData();
  });
</script>

<div class="admin-container">
  <!-- Top Navigation Header -->
  <div class="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a
        href="/admin"
        title="Back to Admin Dashboard"
        class="back-btn"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </a>
      <div>
        <h2>Watermark Templates</h2>
        <p>Configure watermark presets and enforcement rules for public shares.</p>
      </div>
    </div>
    {#if activeTemplate}
      <div style="display: flex; gap: 8px; align-items: center;">
        {#if activeTemplate.id}
          <button
            class="btn secondary"
            onclick={regenerateActiveTemplate}
            disabled={isRegenerating || isSaving}
            title="Purge old cache and pre-render watermarks for active shares"
          >
            <RefreshCw size={18} class={isRegenerating ? 'spin-icon' : ''} />
            {isRegenerating ? 'Regenerating...' : 'Regenerate Photos'}
          </button>
        {/if}
        <button class="btn primary" onclick={saveActiveTemplate} disabled={isSaving || isRegenerating}>
          {#if isSaving}
            Saving...
          {:else}
            <Save size={18} /> Save Preset
          {/if}
        </button>
      </div>
    {/if}
  </div>

  {#if loading}
    <div class="spinner"></div>
  {:else}
    <!-- Global Enforcement Card -->
    <div class="card" style="margin-bottom: 1.5rem;">
      <div class="card-header">
        <ShieldAlert size={20} class="text-blue" />
        <h3>Global Share Enforcement</h3>
      </div>
      <div class="card-body">
        <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="max-width: 600px;">
            <span class="form-label" style="margin: 0;">Enforce Watermark on All Public Shares</span>
            <p class="help" style="margin: 4px 0 0;">
              Permanently burns the selected watermark into all shared photos, overriding individual folder/album share preferences.
            </p>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <select
              bind:value={globalTemplateId}
              onchange={saveGlobalEnforcement}
              disabled={!globalEnforced}
              style="width: 200px;"
            >
              {#each templates as t}
                <option value={t.id}>{t.name} {t.is_default ? '(Default)' : ''}</option>
              {/each}
            </select>
            <label class="switch">
              <input type="checkbox" bind:checked={globalEnforced} onchange={saveGlobalEnforcement} />
              <span class="slider round"></span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Settings & Live Preview Grid -->
    <div class="settings-grid">
      <!-- Left Column: Preset Controls -->
      <div class="column-left">
        <!-- Preset Management Card -->
        <div class="card">
          <div class="card-header">
            <Sliders size={20} class="text-purple" />
            <h3>Preset Manager</h3>
          </div>
          <div class="card-body">
            <div class="form-group">
              <span class="form-label">Select Preset</span>
              <div style="display: flex; gap: 8px;">
                <select value={selectedId} onchange={(e) => selectTemplate((e.target as HTMLSelectElement).value)}>
                  {#each templates as t}
                    <option value={t.id}>{t.name} {t.is_default ? '★' : ''}</option>
                  {/each}
                </select>
                <button class="btn secondary sm" onclick={createNewTemplate} title="Create New Preset">
                  <Plus size={16} /> New
                </button>
                <button class="btn secondary sm" onclick={duplicateTemplate} title="Duplicate Preset" disabled={!activeTemplate?.id}>
                  <Copy size={16} /> Copy
                </button>
                <button class="btn danger sm" onclick={deleteActiveTemplate} title="Delete Preset" disabled={!activeTemplate?.id || templates.length <= 1}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {#if activeTemplate}
              <div style="display: flex; gap: 16px; align-items: flex-end;">
                <div class="form-group" style="flex: 1;">
                  <label for="presetNameInput">Preset Name</label>
                  <input id="presetNameInput" type="text" bind:value={activeTemplate.name} placeholder="e.g. Studio Copyright" />
                </div>
                <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                  <input type="checkbox" id="isDefaultCheck" bind:checked={activeTemplate.is_default} style="width: auto; margin: 0; cursor: pointer;" />
                  <label for="isDefaultCheck" style="margin: 0; cursor: pointer;">Default Preset</label>
                </div>
              </div>
            {/if}
          </div>
        </div>

        {#if activeTemplate}
          <!-- Watermark Type & Content Card -->
          <div class="card">
            <div class="card-header">
              <Type size={20} class="text-blue" />
              <h3>Watermark Content</h3>
            </div>
            <div class="card-body">
              <div class="preset-btns" style="margin-top: 0; margin-bottom: 0.5rem;">
                <button
                  class="btn sm {activeTemplate.type === 'text' ? 'primary' : 'secondary'}"
                  onclick={() => activeTemplate!.type = 'text'}
                >
                  <Type size={14} /> Text Watermark
                </button>
                <button
                  class="btn sm {activeTemplate.type === 'image' ? 'primary' : 'secondary'}"
                  onclick={() => activeTemplate!.type = 'image'}
                >
                  <Image size={14} /> Graphic Logo
                </button>
              </div>

              {#if activeTemplate.type === 'text'}
                <div class="form-group">
                  <label for="watermarkTextArea">Watermark Text (Multiline Supported)</label>
                  <textarea id="watermarkTextArea" rows="3" bind:value={activeTemplate.text_content} placeholder="Enter watermark text or dynamic tags..."></textarea>
                  <div class="token-row">
                    <span class="help" style="margin: 0;">Dynamic Tags:</span>
                    <button type="button" class="btn sm secondary" onclick={() => insertToken('{year}')}>&#123;year&#125;</button>
                    <button type="button" class="btn sm secondary" onclick={() => insertToken('{copyright}')}>&#123;copyright&#125;</button>
                    <button type="button" class="btn sm secondary" onclick={() => insertToken('{camera}')}>&#123;camera&#125;</button>
                    <button type="button" class="btn sm secondary" onclick={() => insertToken('{filename}')}>&#123;filename&#125;</button>
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                  <div class="form-group">
                    <label for="fontFamilySelect">Font Family</label>
                    <select id="fontFamilySelect" bind:value={activeTemplate.font_family}>
                      {#each fontOptions as f}
                        <option value={f.value}>{f.label}</option>
                      {/each}
                    </select>
                  </div>

                  <div class="form-group">
                    <label for="fontWeightSelect">Font Weight</label>
                    <select id="fontWeightSelect" bind:value={activeTemplate.font_weight}>
                      {#each fontWeightOptions as w}
                        <option value={w.value}>{w.label}</option>
                      {/each}
                    </select>
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                  <div class="form-group">
                    <label for="fontStyleSelect">Font Style</label>
                    <select id="fontStyleSelect" bind:value={activeTemplate.font_style}>
                      {#each fontStyleOptions as s}
                        <option value={s.value}>{s.label}</option>
                      {/each}
                    </select>
                  </div>

                  <div class="form-group">
                    <span class="form-label">Font Color</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      <input type="color" bind:value={activeTemplate.font_color} class="color-picker" />
                      <input type="text" bind:value={activeTemplate.font_color} style="width: 100px; font-family: monospace;" />
                    </div>
                  </div>
                </div>

                <div class="form-group">
                  <span class="form-label">Text Alignment</span>
                  <div class="preset-btns" style="margin-top: 0;">
                    <button class="btn sm {activeTemplate.text_align === 'left' ? 'primary' : 'secondary'}" onclick={() => activeTemplate!.text_align = 'left'}>Left</button>
                    <button class="btn sm {activeTemplate.text_align === 'center' ? 'primary' : 'secondary'}" onclick={() => activeTemplate!.text_align = 'center'}>Center</button>
                    <button class="btn sm {activeTemplate.text_align === 'right' ? 'primary' : 'secondary'}" onclick={() => activeTemplate!.text_align = 'right'}>Right</button>
                  </div>
                </div>

                <div class="form-group">
                  <span class="form-label">Letter Spacing</span>
                  <div class="slider-group">
                    <input type="range" min="-2" max="20" step="1" bind:value={activeTemplate.letter_spacing} />
                    <span class="slider-val">{activeTemplate.letter_spacing || 0}px</span>
                  </div>
                </div>

                <div class="form-group">
                  <span class="form-label">Line Spacing</span>
                  <div class="slider-group">
                    <input type="range" min="0.8" max="2.5" step="0.05" bind:value={activeTemplate.line_spacing} />
                    <span class="slider-val">{activeTemplate.line_spacing || 1.25}x</span>
                  </div>
                </div>
              {:else}
                <div class="form-group">
                  <span class="form-label">Logo File</span>
                  {#if activeTemplate.image_path}
                    <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between;">
                      <span style="font-family: monospace; font-size: 0.85rem; color: #a1a1aa;">{activeTemplate.image_path}</span>
                      <label class="btn sm secondary" style="cursor: pointer; margin: 0;">
                        Replace
                        <input type="file" accept="image/png,image/svg+xml,image/jpeg" onchange={handleLogoUpload} style="display: none;" />
                      </label>
                    </div>
                  {:else}
                    <label class="btn secondary" style="cursor: pointer; justify-content: center; padding: 2rem; border: 1px dashed rgba(255,255,255,0.2);">
                      <Image size={24} /> Upload PNG or SVG Logo
                      <input type="file" accept="image/png,image/svg+xml,image/jpeg" onchange={handleLogoUpload} style="display: none;" />
                    </label>
                  {/if}
                  {#if isUploadingLogo}
                    <p class="help">Uploading logo asset...</p>
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          <!-- Lightroom Alignment & Placement Card -->
          <div class="card">
            <div class="card-header">
              <Sliders size={20} class="text-emerald" />
              <h3>Lightroom Anchor & Placement</h3>
            </div>
            <div class="card-body">
              <div style="display: flex; gap: 24px; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin-bottom: 8px;">9-Point Anchor</span>
                  <div class="anchor-grid">
                    {#each anchorGrid as row}
                      <div class="anchor-row">
                        {#each row as pt}
                          <button
                            type="button"
                            class="anchor-dot"
                            class:selected={activeTemplate.anchor === pt}
                            onclick={() => activeTemplate!.anchor = pt}
                            title={pt}
                          ></button>
                        {/each}
                      </div>
                    {/each}
                  </div>
                </div>

                <div style="flex: 1; display: flex; flex-direction: column; gap: 12px;">
                  <div class="form-group">
                    <span class="form-label">Horizontal Inset</span>
                    <div class="slider-group">
                      <input type="range" min="0" max="30" step="1" bind:value={activeTemplate.inset_x} />
                      <span class="slider-val">{activeTemplate.inset_x ?? 3}%</span>
                    </div>
                  </div>
                  <div class="form-group">
                    <span class="form-label">Vertical Inset</span>
                    <div class="slider-group">
                      <input type="range" min="0" max="30" step="1" bind:value={activeTemplate.inset_y} />
                      <span class="slider-val">{activeTemplate.inset_y ?? 3}%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-group" style="margin-top: 1rem;">
                <label for="scaleModeSelect">Scaling Mode</label>
                <select id="scaleModeSelect" bind:value={activeTemplate.scale_mode}>
                  <option value="proportional_long_edge">Proportional to Long Edge (Standard)</option>
                  <option value="proportional_short_edge">Proportional to Short Edge</option>
                  <option value="fit">Fit Within Image</option>
                  <option value="exact_px">Fixed Pixel Width</option>
                </select>
              </div>

              <div class="form-group">
                <span class="form-label">{activeTemplate.type === 'image' ? 'Logo Scale' : 'Text Size / Scale'}</span>
                <div class="slider-group">
                  <input
                    type="range"
                    min={activeTemplate.scale_mode === 'exact_px' ? 6 : 0.5}
                    max={activeTemplate.scale_mode === 'exact_px' ? 120 : 50}
                    step={activeTemplate.scale_mode === 'exact_px' ? 1 : 0.5}
                    bind:value={activeTemplate.scale_value}
                  />
                  <span class="slider-val">
                    {activeTemplate.scale_value != null ? activeTemplate.scale_value : 15}{activeTemplate.scale_mode === 'exact_px' ? 'px' : '%'}
                  </span>
                </div>
              </div>

              <div class="form-group">
                <span class="form-label">Master Opacity</span>
                <div class="slider-group">
                  <input type="range" min="0.1" max="1" step="0.05" bind:value={activeTemplate.opacity} />
                  <span class="slider-val">{Math.round((activeTemplate.opacity || 0.85) * 100)}%</span>
                </div>
              </div>

              <div class="form-group">
                <span class="form-label">Rotation</span>
                <div class="preset-btns" style="margin-top: 0;">
                  {#each [0, 90, 180, 270] as deg}
                    <button
                      type="button"
                      class="btn sm {(((Number(activeTemplate.rotation) || 0) % 360 + 360) % 360) === deg ? 'primary' : 'secondary'}"
                      style="flex: 1; justify-content: center;"
                      onclick={() => activeTemplate!.rotation = deg}
                    >
                      {deg}°
                    </button>
                  {/each}
                </div>
              </div>

              <div style="height: 1px; background: rgba(255,255,255,0.1); margin: 8px 0;"></div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin: 0;">Diagonal Tiled Proofing Mode</span>
                  <p class="help" style="margin: 2px 0 0;">Repeats watermark diagonally across the photo to protect proofs.</p>
                </div>
                <label class="switch">
                  <input type="checkbox" bind:checked={activeTemplate.is_tiled} />
                  <span class="slider round"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- Drop Shadow & Background Box Card -->
          <div class="card">
            <div class="card-header">
              <Sliders size={20} class="text-purple" />
              <h3>Shadow & Background Badge</h3>
            </div>
            <div class="card-body">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin: 0;">Drop Shadow</span>
                  <p class="help" style="margin: 2px 0 0;">Soft shadow behind text/logo for high-contrast visibility.</p>
                </div>
                <label class="switch">
                  <input type="checkbox" bind:checked={activeTemplate.shadow_enabled} />
                  <span class="slider round"></span>
                </label>
              </div>

              {#if activeTemplate.shadow_enabled}
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
                  <div class="form-group">
                    <span class="form-label">Shadow Color & Opacity</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      <input type="color" bind:value={activeTemplate.shadow_color} class="color-picker" />
                      <input type="range" min="0" max="1" step="0.05" bind:value={activeTemplate.shadow_opacity} style="flex: 1;" />
                      <span class="slider-val">{Math.round((activeTemplate.shadow_opacity || 0.75) * 100)}%</span>
                    </div>
                  </div>

                  <div class="form-group">
                    <span class="form-label">Blur Softness</span>
                    <div class="slider-group">
                      <input type="range" min="0" max="20" step="1" bind:value={activeTemplate.shadow_radius} />
                      <span class="slider-val">{activeTemplate.shadow_radius || 4}px</span>
                    </div>
                  </div>
                </div>
              {/if}

              <div style="height: 1px; background: rgba(255,255,255,0.1); margin: 8px 0;"></div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin: 0;">Background Badge Box</span>
                  <p class="help" style="margin: 2px 0 0;">Renders an elegant badge container behind the watermark.</p>
                </div>
                <label class="switch">
                  <input type="checkbox" bind:checked={activeTemplate.bg_box_enabled} />
                  <span class="slider round"></span>
                </label>
              </div>

              {#if activeTemplate.bg_box_enabled}
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
                  <div class="form-group">
                    <span class="form-label">Box Color & Opacity</span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                      <input type="color" bind:value={activeTemplate.bg_box_color} class="color-picker" />
                      <input type="range" min="0" max="1" step="0.05" bind:value={activeTemplate.bg_box_opacity} style="flex: 1;" />
                      <span class="slider-val">{Math.round((activeTemplate.bg_box_opacity || 0.5) * 100)}%</span>
                    </div>
                  </div>

                  <div class="form-group">
                    <span class="form-label">Corner Radius</span>
                    <div class="slider-group">
                      <input type="range" min="0" max="30" step="1" bind:value={activeTemplate.bg_box_border_radius} />
                      <span class="slider-val">{activeTemplate.bg_box_border_radius || 6}px</span>
                    </div>
                  </div>

                  <div class="form-group">
                    <span class="form-label">Horizontal Padding</span>
                    <div class="slider-group">
                      <input type="range" min="4" max="36" step="2" bind:value={activeTemplate.bg_box_padding_x} />
                      <span class="slider-val">{activeTemplate.bg_box_padding_x || 14}px</span>
                    </div>
                  </div>

                  <div class="form-group">
                    <span class="form-label">Vertical Padding</span>
                    <div class="slider-group">
                      <input type="range" min="4" max="28" step="2" bind:value={activeTemplate.bg_box_padding_y} />
                      <span class="slider-val">{activeTemplate.bg_box_padding_y || 10}px</span>
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          </div>

          <!-- Resolution & Download Enforcement Card -->
          <div class="card">
            <div class="card-header">
              <Download size={20} class="text-blue" />
              <h3>Resolution & Download Policy</h3>
            </div>
            <div class="card-body">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin: 0;">Allow Original HD Downloads</span>
                  <p class="help" style="margin: 2px 0 0;">When disabled, downloads are strictly restricted to 1080p or 500px.</p>
                </div>
                <label class="switch">
                  <input type="checkbox" bind:checked={activeTemplate.allow_hd_download} />
                  <span class="slider round"></span>
                </label>
              </div>

              {#if !activeTemplate.allow_hd_download}
                <div class="form-group" style="background: rgba(255,255,255,0.03); padding: 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08);">
                  <label for="restrictedTierSelect">Restricted Resolution Tier</label>
                  <p class="help">Visitors attempting to download files will strictly receive this tier with the watermark burned in.</p>
                  <select id="restrictedTierSelect" bind:value={activeTemplate.restricted_tier}>
                    <option value="1080p">1080p Web Resolution (~1920x1080 WebP/JPEG)</option>
                    <option value="500px">500px Thumbnail Resolution (~480x500 WebP/JPEG)</option>
                  </select>
                </div>
              {/if}

              <div style="height: 1px; background: rgba(255,255,255,0.1); margin: 8px 0;"></div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin: 0;">Watermark Downloads</span>
                  <p class="help" style="margin: 2px 0 0;">Burn watermark into single-file downloads and bulk ZIP archives.</p>
                </div>
                <label class="switch">
                  <input type="checkbox" bind:checked={activeTemplate.apply_to_downloads} />
                  <span class="slider round"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <span class="form-label" style="display: block; margin: 0;">Watermark Lightbox Previews</span>
                  <p class="help" style="margin: 2px 0 0;">Burn watermark into preview images shown in gallery.</p>
                </div>
                <label class="switch">
                  <input type="checkbox" bind:checked={activeTemplate.apply_to_previews} />
                  <span class="slider round"></span>
                </label>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Right Column: Live Vector Preview Canvas -->
      <div class="column-right">
        <div class="card preview-card">
          <div class="card-header" style="justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <Eye size={20} class="text-blue" />
              <h3 style="margin: 0;">Live Preview</h3>
              {#if sampleImages.length > 0}
                <button
                  class="btn sm {useRealPhoto ? 'primary' : 'secondary'}"
                  onclick={() => { useRealPhoto = !useRealPhoto; serverPreviewUrl = null; }}
                  title="Toggle between actual library photo and plain canvas"
                >
                  <Camera size={13} style="margin-right: 4px;" />
                  {useRealPhoto ? 'Real Photo' : 'Plain Canvas'}
                </button>
              {/if}
            </div>
            <div class="preset-btns" style="margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              {#if useRealPhoto && sampleImages.length > 0}
                <div style="display: flex; align-items: center; gap: 4px;">
                  <button
                    class="btn sm secondary"
                    onclick={() => {
                      selectedSampleIndex = (selectedSampleIndex - 1 + sampleImages.length) % sampleImages.length;
                      serverPreviewUrl = null;
                    }}
                    title="Previous photo in library"
                  >
                    ‹
                  </button>
                  <span class="meta-pill" style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={selectedSampleImage?.file_name}>
                    {selectedSampleIndex + 1}/{sampleImages.length}: {selectedSampleImage?.file_name || 'Photo'}
                  </span>
                  <button
                    class="btn sm secondary"
                    onclick={() => {
                      selectedSampleIndex = (selectedSampleIndex + 1) % sampleImages.length;
                      serverPreviewUrl = null;
                    }}
                    title="Next photo in library"
                  >
                    ›
                  </button>
                </div>
              {:else}
                <button
                  class="btn sm {!useRealPhoto && previewSampleType === 'landscape' ? 'primary' : 'secondary'}"
                  onclick={() => { useRealPhoto = false; previewSampleType = 'landscape'; serverPreviewUrl = null; }}
                >
                  Landscape
                </button>
                <button
                  class="btn sm {!useRealPhoto && previewSampleType === 'portrait' ? 'primary' : 'secondary'}"
                  onclick={() => { useRealPhoto = false; previewSampleType = 'portrait'; serverPreviewUrl = null; }}
                >
                  Portrait
                </button>
                <button
                  class="btn sm {!useRealPhoto && previewSampleType === 'dark' ? 'primary' : 'secondary'}"
                  onclick={() => { useRealPhoto = false; previewSampleType = 'dark'; serverPreviewUrl = null; }}
                >
                  Dark
                </button>
                <button
                  class="btn sm {!useRealPhoto && previewSampleType === 'light' ? 'primary' : 'secondary'}"
                  onclick={() => { useRealPhoto = false; previewSampleType = 'light'; serverPreviewUrl = null; }}
                >
                  Light
                </button>
              {/if}
            </div>
          </div>

          <div class="card-body" style="padding: 1.25rem;">
            <!-- Scalable Vector Canvas Viewport -->
            <div
              class="viewport-box"
              class:is-portrait={useRealPhoto && selectedSampleImage ? (selectedSampleImage.img_height > selectedSampleImage.img_width) : (previewSampleType === 'portrait')}
              style="aspect-ratio: {previewLayout?.canvasW || 1200} / {previewLayout?.canvasH || 800};"
            >
              {#if serverPreviewUrl}
                <img src={serverPreviewUrl} alt="Server Watermark Render" class="preview-img" />
              {:else if previewLayout && activeTemplate}
                <svg
                  viewBox="0 0 {previewLayout.canvasW} {previewLayout.canvasH}"
                  class="preview-svg"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    {#if previewSampleType === 'light'}
                      <linearGradient id="photoBg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#f8fafc" />
                        <stop offset="50%" stop-color="#e2e8f0" />
                        <stop offset="100%" stop-color="#cbd5e1" />
                      </linearGradient>
                    {:else if previewSampleType === 'dark'}
                      <linearGradient id="photoBg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#09090b" />
                        <stop offset="60%" stop-color="#111827" />
                        <stop offset="100%" stop-color="#020617" />
                      </linearGradient>
                    {:else if previewSampleType === 'portrait'}
                      <linearGradient id="photoBg" x1="20%" y1="0%" x2="80%" y2="100%">
                        <stop offset="0%" stop-color="#1e293b" />
                        <stop offset="50%" stop-color="#0f172a" />
                        <stop offset="100%" stop-color="#020617" />
                      </linearGradient>
                    {:else}
                      <linearGradient id="photoBg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#1e293b" />
                        <stop offset="40%" stop-color="#334155" />
                        <stop offset="100%" stop-color="#0f172a" />
                      </linearGradient>
                    {/if}

                    {#if activeTemplate.shadow_enabled}
                      <filter id="preview-shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow
                          dx={activeTemplate.shadow_offset_x}
                          dy={activeTemplate.shadow_offset_y}
                          stdDeviation={activeTemplate.shadow_radius}
                          flood-color={activeTemplate.shadow_color}
                          flood-opacity={activeTemplate.shadow_opacity}
                        />
                      </filter>
                    {/if}

                    {#if activeTemplate.is_tiled}
                      {@const tileW = Math.max(340, Math.max(...previewTextLines.map(l => l.length), 5) * 18 + 80)}
                      {@const tileH = Math.max(220, previewTextLines.length * 36 + 140)}
                      {@const midX = Math.round(tileW / 2)}
                      {@const lineHeight = 36}
                      {@const startY = Math.round(tileH / 2) - Math.round(((previewTextLines.length - 1) * lineHeight) / 2)}
                      {@const rotation = activeTemplate.rotation !== 0 ? activeTemplate.rotation : -30}
                      <pattern id="preview-tiled-pattern" width={tileW} height={tileH} patternUnits="userSpaceOnUse" patternTransform="rotate({rotation})">
                        <text
                          x={midX}
                          y={startY}
                          text-anchor="middle"
                          dominant-baseline="middle"
                          font-family={activeTemplate.font_family}
                          font-weight={activeTemplate.font_weight || 'bold'}
                          font-style={activeTemplate.font_style || 'normal'}
                          font-size="28"
                          fill={activeTemplate.font_color}
                          fill-opacity={activeTemplate.opacity}
                          stroke="#000000"
                          stroke-width="1"
                          stroke-opacity={activeTemplate.opacity * 0.8}
                        >
                          {#each previewTextLines as line, i}
                            <tspan x={midX} y={startY + i * lineHeight}>{line}</tspan>
                          {/each}
                        </text>
                      </pattern>
                    {/if}
                  </defs>

                  <!-- Photo Canvas Base -->
                  {#if useRealPhoto && selectedSampleImage}
                    <image
                      href="{API_BASE}/api/media/{selectedSampleImage.id}/preview"
                      x="0"
                      y="0"
                      width={previewLayout.canvasW}
                      height={previewLayout.canvasH}
                      preserveAspectRatio="xMidYMid meet"
                    />
                  {:else}
                    <rect width="100%" height="100%" fill="url(#photoBg)" rx="8" />
                  {/if}

                  <!-- Rule of Thirds Grid Overlay -->
                  <line x1="33.3%" y1="0" x2="33.3%" y2="100%" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="6 6" />
                  <line x1="66.6%" y1="0" x2="66.6%" y2="100%" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="6 6" />
                  <line x1="0" y1="33.3%" x2="100%" y2="33.3%" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="6 6" />
                  <line x1="0" y1="66.6%" x2="100%" y2="66.6%" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="6 6" />

                  {#if activeTemplate.is_tiled}
                    <rect width="100%" height="100%" fill="url(#preview-tiled-pattern)" />
                  {:else}
                    <g
                      transform={previewLayout.transform}
                      opacity={activeTemplate.opacity}
                    >
                      {#if activeTemplate.bg_box_enabled}
                        <rect
                          x="0"
                          y="0"
                          width={previewLayout.boxW}
                          height={previewLayout.boxH}
                          rx={activeTemplate.bg_box_border_radius}
                          fill={activeTemplate.bg_box_color}
                          fill-opacity={activeTemplate.bg_box_opacity}
                          filter={activeTemplate.shadow_enabled ? "url(#preview-shadow)" : undefined}
                        />
                      {/if}

                      <text
                        x={previewLayout.textX}
                        text-anchor={previewLayout.textAnchor}
                        font-family={activeTemplate.font_family}
                        font-weight={activeTemplate.font_weight}
                        font-style={activeTemplate.font_style}
                        font-size={previewLayout.fontSize}
                        fill={activeTemplate.font_color}
                        letter-spacing="{activeTemplate.letter_spacing}px"
                        filter={!activeTemplate.bg_box_enabled && activeTemplate.shadow_enabled ? "url(#preview-shadow)" : undefined}
                      >
                        {#each previewTextLines as line, i}
                          <tspan
                            x={previewLayout.textX}
                            y={previewLayout.padY + i * previewLayout.lineHeight}
                            dominant-baseline="hanging"
                          >
                            {line}
                          </tspan>
                        {/each}
                      </text>
                    </g>
                  {/if}
                </svg>
              {/if}
            </div>

            <!-- Footer Details & Test Render Action (Resolution placed outside preview) -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="meta-pill">
                  {previewLayout?.canvasW || 1200} × {previewLayout?.canvasH || 800} px
                </span>
                <span class="help" style="margin: 0;">
                  {serverPreviewUrl ? 'Server-rendered WebP' : 'Interactive vector preview'}
                </span>
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                {#if serverPreviewUrl}
                  <button
                    class="btn sm secondary"
                    onclick={() => {
                      if (serverPreviewUrl) URL.revokeObjectURL(serverPreviewUrl);
                      serverPreviewUrl = null;
                    }}
                    title="Return to real-time interactive preview"
                  >
                    <Eye size={14} />
                    Live Vector View
                  </button>
                {/if}
                <button
                  class="btn sm secondary"
                  onclick={triggerServerPreview}
                  disabled={isServerRendering}
                  title="Rasterize sample directly via Sharp on backend"
                >
                  <RefreshCw size={14} class={isServerRendering ? 'spin-icon' : ''} />
                  {isServerRendering ? 'Rendering...' : 'Test Server Raster'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-container {
    width: 100%;
    color: #f4f4f5;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 2rem;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    line-height: 0;
    color: rgba(255, 255, 255, 0.4);
    text-decoration: none;
    transition: color 0.2s, transform 0.2s;
  }
  .back-btn:hover {
    color: white;
    transform: scale(1.1);
  }

  h2 {
    font-size: 2rem;
    margin: 0 0 0.5rem 0;
    font-family: 'Cabinet Grotesk', sans-serif;
  }

  p {
    color: #a1a1aa;
    margin: 0;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  .column-left {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .column-right {
    position: sticky;
    top: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .card {
    background: rgba(20, 20, 25, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
  }

  .card-header {
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .card-header h3 {
    margin: 0;
    font-size: 1.2rem;
    color: #f4f4f5;
  }

  .card-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  :global(.text-blue) { color: #38bdf8; }
  :global(.text-purple) { color: #a855f7; }
  :global(.text-emerald) { color: #10b981; }

  .form-group label, .form-label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
    font-size: 0.95rem;
    color: #cbd5e1;
  }

  .help {
    color: #71717a;
    font-size: 0.8rem;
    margin: 0 0 0.5rem 0;
  }

  input[type="text"], textarea {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.75rem;
    border-radius: 6px;
    color: white;
    font-family: inherit;
  }
  input[type="text"]:focus, textarea:focus {
    outline: none;
    border-color: #a855f7;
  }

  select {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.75rem;
    border-radius: 6px;
    color: white;
    font-family: inherit;
    appearance: auto;
  }
  select:focus {
    outline: none;
    border-color: #a855f7;
  }
  select option {
    background: #1a1a2e;
    color: white;
  }

  .slider-group {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  input[type="range"] {
    flex: 1;
    cursor: pointer;
    accent-color: #a855f7;
  }
  .slider-val {
    background: rgba(168, 85, 247, 0.2);
    color: #d8b4fe;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.85rem;
    min-width: 48px;
    text-align: center;
  }

  .preset-btns {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
  }
  .btn.primary {
    background: linear-gradient(135deg, #6366f1, #a855f7);
    color: white;
  }
  .btn.secondary {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
  .btn.danger {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .btn.sm {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
  }
  .btn:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }

  .color-picker {
    width: 38px;
    height: 38px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: none;
    cursor: pointer;
    padding: 0;
  }

  /* 9-Point Anchor Grid */
  .anchor-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: rgba(0, 0, 0, 0.35);
    padding: 8px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    width: 86px;
  }
  .anchor-row {
    display: flex;
    justify-content: space-between;
  }
  .anchor-dot {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.2);
    cursor: pointer;
    transition: all 0.15s;
  }
  .anchor-dot:hover {
    background: rgba(168, 85, 247, 0.5);
  }
  .anchor-dot.selected {
    background: #a855f7;
    border-color: #d8b4fe;
    box-shadow: 0 0 8px rgba(168, 85, 247, 0.6);
  }

  /* Switches */
  .switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.15);
    transition: 0.2s;
  }
  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
  }
  input:checked + .slider {
    background-color: #a855f7;
  }
  input:checked + .slider:before {
    transform: translateX(20px);
  }
  .slider.round {
    border-radius: 24px;
  }
  .slider.round:before {
    border-radius: 50%;
  }

  /* Preview Viewport */
  .preview-card {
    padding: 0;
    overflow: hidden;
  }

  .viewport-box {
    width: 100%;
    aspect-ratio: 3 / 2;
    background: #09090b;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
    box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .viewport-box.is-portrait {
    aspect-ratio: 2 / 3;
    max-height: 520px;
    margin: 0 auto;
  }

  .preview-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .preview-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .meta-pill {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    color: #cbd5e1;
    font-family: monospace;
  }

  .spinner {
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid #a855f7;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin: 4rem auto;
  }

  :global(.spin-icon) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    h2 { font-size: 1.5rem; }
    .header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .settings-grid {
      grid-template-columns: 1fr;
    }
    .column-right {
      position: static;
    }
    .preset-btns {
      flex-wrap: wrap;
    }
    .card-body {
      padding: 1.25rem;
    }
  }
</style>
