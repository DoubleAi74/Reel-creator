"use client";

import { ProjectJsonModal } from "@/components/project-json-modal";
import { RenderExportModal } from "@/components/render-export-modal";

// Thin wrapper around the two trailing modals. All values/closures are computed
// in the shell and threaded through grouped props; the export modal keeps its
// render-nothing-when-closed gate. (`exportModal` avoids the reserved word `export`.)
export function EditorModals({ json, exportModal }) {
  return (
    <>
      <ProjectJsonModal
        draft={json.draft}
        errorMessage={json.errorMessage}
        isOpen={json.isOpen}
        onChange={json.onChange}
        onClose={json.onClose}
        onFileSelected={json.onFileSelected}
        onImport={json.onImport}
        onStartNew={json.onStartNew}
      />

      {exportModal.isOpen ? (
        <RenderExportModal
          downloadError={exportModal.downloadError}
          errorMessage={exportModal.errorMessage}
          isDownloading={exportModal.isDownloading}
          isReconnecting={exportModal.isReconnecting}
          lineCount={exportModal.lineCount}
          onClose={exportModal.onClose}
          onDownload={exportModal.onDownload}
          onRetry={exportModal.onRetry}
          formatLabel={exportModal.formatLabel}
          phase={exportModal.phase}
          progressPercent={exportModal.progressPercent}
          projectTitle={exportModal.projectTitle}
          renderStatus={exportModal.renderStatus}
          sectionLengthLabel={exportModal.sectionLengthLabel}
          statusNote={exportModal.statusNote}
        />
      ) : null}
    </>
  );
}
