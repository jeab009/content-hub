'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient, ApiError } from '@/lib/api-client';
import { canMarkReady, readyBlockers } from '@/lib/copyright-gate';
import { AppHeader } from '@/components/AppHeader';
import { ContentDetailsFields } from '@/components/content/ContentDetailsFields';
import { CopyrightGatePanel } from '@/components/content/CopyrightGatePanel';
import { AssetsSection } from '@/components/content/AssetsSection';
import {
  emptyForm,
  formFromContent,
  toCreateInput,
  toGateState,
  toUpdateInput,
  validateForm,
  type EditorForm,
} from '@/components/content/editor-form';

interface ContentEditorProps {
  mode: 'new' | 'edit';
  contentId?: string;
}

/** Shared create/edit screen for a single piece of content. */
export function ContentEditor({ mode, contentId }: ContentEditorProps): JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<EditorForm>(emptyForm);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [, csrf] = await Promise.all([apiClient.me(), apiClient.getCsrfToken()]);
      setCsrfToken(csrf.csrfToken);
      if (mode === 'edit' && contentId) {
        const content = await apiClient.getContent(contentId);
        setForm(formFromContent(content));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        return;
      }
      setError('Failed to load content.');
    } finally {
      setIsLoading(false);
    }
  }, [mode, contentId, router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const update = useCallback((patch: Partial<EditorForm>): void => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  async function save(markReady: boolean): Promise<void> {
    if (!csrfToken) return;
    const validationError = validateForm(form, mode === 'new');
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      if (mode === 'new') {
        const created = await apiClient.createContent(toCreateInput(form, markReady), csrfToken);
        router.push(`/content/${created.id}/edit`);
        return;
      }
      const updated = await apiClient.updateContent(
        contentId as string,
        toUpdateInput(form, markReady),
        csrfToken,
      );
      setForm(formFromContent(updated));
      setNotice(markReady ? 'Content marked ready.' : 'Changes saved.');
    } catch (err) {
      // Surfaces the backend copyright-gate 400 message verbatim.
      setError(err instanceof ApiError ? err.message : 'Failed to save content.');
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p>Loading…</p>;
  }

  if (notFound) {
    return (
      <div>
        <AppHeader />
        <div className="alert alert-warning" role="alert">
          Content not found.
        </div>
        <Link href="/content" className="btn btn-outline-secondary">
          Back to library
        </Link>
      </div>
    );
  }

  const gate = toGateState(form);
  const readyEnabled = canMarkReady(gate) && !isSaving;
  const blockers = readyBlockers(gate);

  return (
    <div>
      <AppHeader />

      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0">{mode === 'new' ? 'New content' : 'Edit content'}</h1>
        <Link href="/content" className="btn btn-outline-secondary btn-sm">
          Back to library
        </Link>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      <ContentDetailsFields form={form} csrfToken={csrfToken} onChange={update} />

      <CopyrightGatePanel
        gate={gate}
        copyrightNotes={form.copyrightNotes}
        csrfToken={csrfToken}
        onClearanceChange={(value) => update({ copyrightCleared: value })}
        onEvidenceChange={(value) => update({ copyrightEvidenceUrl: value })}
        onNotesChange={(value) => update({ copyrightNotes: value })}
      />

      {mode === 'edit' && contentId ? (
        <AssetsSection contentId={contentId} csrfToken={csrfToken} />
      ) : (
        <div className="alert alert-info" role="note">
          Save the content first to add per-platform assets.
        </div>
      )}

      <div className="d-flex flex-wrap align-items-center gap-2 mb-5">
        <button
          type="button"
          className="btn btn-primary"
          disabled={isSaving}
          onClick={() => void save(false)}
        >
          Save as Draft
        </button>
        <button
          type="button"
          className="btn btn-success"
          disabled={!readyEnabled}
          onClick={() => void save(true)}
          aria-describedby="mark-ready-help"
        >
          Mark Ready
        </button>
        {blockers.length > 0 && (
          <span id="mark-ready-help" className="text-danger small">
            Mark Ready is disabled: {blockers.join(' ')}
          </span>
        )}
      </div>
    </div>
  );
}
