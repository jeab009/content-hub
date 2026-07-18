import type {
  Content,
  ContentPillar,
  ContentType,
  CopyrightClearance,
  CreateContentInput,
  LicensingStatus,
  UpdateContentInput,
} from '@/lib/api-client';
import type { CopyrightGateState } from '@/lib/copyright-gate';

/** In-memory shape of the content editor form. */
export interface EditorForm {
  type: ContentType;
  title: string;
  caption: string;
  targetAgeMin: number;
  targetAgeMax: number;
  licensingStatus: LicensingStatus;
  licenseNotes: string;
  contentPillar: ContentPillar | '';
  mediaUrl: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  copyrightCleared: CopyrightClearance;
  copyrightEvidenceUrl: string;
  copyrightNotes: string;
}

export const DEFAULT_AGE_MIN = 18;
export const DEFAULT_AGE_MAX = 45;

export function emptyForm(): EditorForm {
  return {
    type: 'video',
    title: '',
    caption: '',
    targetAgeMin: DEFAULT_AGE_MIN,
    targetAgeMax: DEFAULT_AGE_MAX,
    licensingStatus: 'unlicensed',
    licenseNotes: '',
    contentPillar: '',
    mediaUrl: '',
    fileSizeBytes: null,
    mimeType: null,
    copyrightCleared: 'not_checked',
    copyrightEvidenceUrl: '',
    copyrightNotes: '',
  };
}

export function formFromContent(content: Content): EditorForm {
  return {
    type: content.type,
    title: content.title,
    caption: content.caption ?? '',
    targetAgeMin: content.targetAgeMin,
    targetAgeMax: content.targetAgeMax,
    licensingStatus: content.licensingStatus,
    licenseNotes: content.licenseNotes ?? '',
    contentPillar: content.contentPillar ?? '',
    mediaUrl: content.mediaUrl,
    fileSizeBytes: content.fileSizeBytes !== null ? Number(content.fileSizeBytes) : null,
    mimeType: content.mimeType,
    copyrightCleared: content.copyrightCleared,
    copyrightEvidenceUrl: content.copyrightEvidenceUrl ?? '',
    copyrightNotes: content.copyrightNotes ?? '',
  };
}

export function toGateState(form: EditorForm): CopyrightGateState {
  return {
    copyrightCleared: form.copyrightCleared,
    contentPillar: form.contentPillar === '' ? null : form.contentPillar,
    copyrightEvidenceUrl: form.copyrightEvidenceUrl,
  };
}

/** Validate required fields before a create/save. Returns a message or null. */
export function validateForm(form: EditorForm, requireMedia: boolean): string | null {
  if (form.title.trim().length === 0) {
    return 'Title is required.';
  }
  if (requireMedia && form.mediaUrl.trim().length === 0) {
    return 'A media file must be uploaded before saving.';
  }
  if (form.targetAgeMin > form.targetAgeMax) {
    return 'Target age (min) must be less than or equal to target age (max).';
  }
  return null;
}

export function toCreateInput(form: EditorForm, markReady: boolean): CreateContentInput {
  return {
    type: form.type,
    title: form.title.trim(),
    mediaUrl: form.mediaUrl,
    caption: form.caption || undefined,
    targetAgeMin: form.targetAgeMin,
    targetAgeMax: form.targetAgeMax,
    licensingStatus: form.licensingStatus,
    licenseNotes: form.licenseNotes || undefined,
    markReady,
    contentPillar: form.contentPillar === '' ? undefined : form.contentPillar,
    copyrightCleared: form.copyrightCleared,
    copyrightNotes: form.copyrightNotes || undefined,
    copyrightEvidenceUrl: form.copyrightEvidenceUrl || undefined,
    fileSizeBytes: form.fileSizeBytes ?? undefined,
    mimeType: form.mimeType ?? undefined,
  };
}

export function toUpdateInput(form: EditorForm, markReady: boolean): UpdateContentInput {
  const input: UpdateContentInput = {
    type: form.type,
    title: form.title.trim(),
    caption: form.caption,
    targetAgeMin: form.targetAgeMin,
    targetAgeMax: form.targetAgeMax,
    licensingStatus: form.licensingStatus,
    licenseNotes: form.licenseNotes,
    copyrightCleared: form.copyrightCleared,
    copyrightNotes: form.copyrightNotes,
    copyrightEvidenceUrl: form.copyrightEvidenceUrl,
  };
  // The update DTO's contentPillar can only be set, not nulled — omit when
  // none is selected so we never send an invalid empty enum value.
  if (form.contentPillar !== '') {
    input.contentPillar = form.contentPillar;
  }
  if (markReady) {
    input.status = 'ready';
  }
  return input;
}
