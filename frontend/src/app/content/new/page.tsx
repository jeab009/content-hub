'use client';

import type { JSX } from 'react';

import { ContentEditor } from '@/components/content/ContentEditor';

export default function NewContentPage(): JSX.Element {
  return <ContentEditor mode="new" />;
}
