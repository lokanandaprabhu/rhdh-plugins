/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useMemo, useRef } from 'react';

import { InfoCard } from '@backstage/core-components';

import { open } from '@kie-tools/serverless-workflow-standalone-editor/dist/swf';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';

import { WorkflowFormatDTO } from '@red-hat-developer-hub/backstage-plugin-orchestrator-common';

import { useTranslation } from '../../hooks/useTranslation';

type WorkflowSwfEditorCardProps = {
  format: WorkflowFormatDTO;
  loadingWorkflowSource: boolean;
  workflowSource?: string;
  errorWorkflowSource?: Error;
  editorMode: 'full' | 'diagram';
  title: string;
};

type ServerlessWorkflowType = 'json' | 'yaml' | 'yml';

export const WorkflowSwfEditorCard = ({
  format,
  loadingWorkflowSource,
  workflowSource,
  errorWorkflowSource,
  editorMode,
  title,
}: WorkflowSwfEditorCardProps) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<typeof open> | null>(null);

  const languageType = useMemo<ServerlessWorkflowType>(
    () => (format === WorkflowFormatDTO.Json ? 'json' : 'yaml'),
    [format],
  );

  useEffect(() => {
    if (
      loadingWorkflowSource ||
      errorWorkflowSource ||
      !workflowSource ||
      !containerRef.current
    ) {
      return undefined;
    }

    editorRef.current?.close();
    const swfPreviewOptions =
      editorMode === 'diagram'
        ? {
            editorMode: 'diagram',
            defaultWidth: '100%',
          }
        : undefined;

    editorRef.current = open({
      container: containerRef.current,
      initialContent: Promise.resolve(workflowSource),
      languageType,
      readOnly: true,
      swfPreviewOptions,
    });

    return () => {
      editorRef.current?.close();
      editorRef.current = null;
    };
  }, [
    editorMode,
    errorWorkflowSource,
    languageType,
    loadingWorkflowSource,
    workflowSource,
  ]);

  return (
    <InfoCard title={title}>
      {(errorWorkflowSource || !workflowSource) && (
        <Alert severity="info">{t('workflow.swfEditorUnavailable')}</Alert>
      )}
      {!errorWorkflowSource && workflowSource && (
        <Box
          sx={{
            height: 720,
            width: '100%',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </Box>
      )}
    </InfoCard>
  );
};
