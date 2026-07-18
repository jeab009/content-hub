'use client';

import { ContentEditor } from '@/components/content/ContentEditor';

interface EditContentPageProps {
  params: { id: string };
}

export default function EditContentPage({ params }: EditContentPageProps): JSX.Element {
  return <ContentEditor mode="edit" contentId={params.id} />;
}
