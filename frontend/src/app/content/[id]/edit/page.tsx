'use client';

import { use } from 'react';
import type { JSX } from 'react';

import { ContentEditor } from '@/components/content/ContentEditor';

interface EditContentPageProps {
  params: Promise<{ id: string }>;
}

export default function EditContentPage(props: EditContentPageProps): JSX.Element {
  const params = use(props.params);
  return <ContentEditor mode="edit" contentId={params.id} />;
}
