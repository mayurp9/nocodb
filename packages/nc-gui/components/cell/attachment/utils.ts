import type { AttachmentType } from 'nocodb-sdk'
import RenameFile from './RenameFile.vue'
import {
  ColumnInj,
  EditModeInj,
  IsFormInj,
  IsPublicInj,
  MetaInj,
  NOCO,
  ReadonlyInj,
  computed,
  inject,
  isImage,
  message,
  ref,
  useApi,
  useFileDialog,
  useI18n,
  useInjectionState,
  useProject,
  watch,
} from '#imports'
import MdiPdfBox from '~icons/mdi/pdf-box'
import MdiFileWordOutline from '~icons/mdi/file-word-outline'
import MdiFilePowerpointBox from '~icons/mdi/file-powerpoint-box'
import MdiFileExcelOutline from '~icons/mdi/file-excel-outline'
import IcOutlineInsertDriveFile from '~icons/ic/outline-insert-drive-file'

export const [useProvideAttachmentCell, useAttachmentCell] = useInjectionState(
  (updateModelValue: (data: string | Record<string, any>[]) => void) => {
    const isReadonly = inject(ReadonlyInj, ref(false))

    const isPublic = inject(IsPublicInj, ref(false))

    const isForm = inject(IsFormInj, ref(false))

    const meta = inject(MetaInj, ref())

    const column = inject(ColumnInj, ref())

    const editEnabled = inject(EditModeInj, ref(false))

    /** keep user selected File object */
    const storedFiles = ref<AttachmentType[]>([])

    const attachments = ref<AttachmentType[]>([])

    const modalVisible = ref(false)

    /** for image carousel */
    const selectedImage = ref()

    const { project } = useProject()

    const { api, isLoading } = useApi()

    const { files, open } = useFileDialog()

    const { appInfo } = useGlobal()

    const { t } = useI18n()

    const defaultAttachmentMeta = {
      ...(appInfo.value.ee && {
        // Maximum Number of Attachments per cell
        maxNumberOfAttachments: Math.max(1, +appInfo.value.ncMaxAttachmentsAllowed || 50) || 50,
        // Maximum File Size per file
        maxAttachmentSize: Math.max(1, +appInfo.value.ncMaxAttachmentsAllowed || 20) || 20,
        supportedAttachmentMimeTypes: ['*'],
      }),
    }

    /** our currently visible items, either the locally stored or the ones from db, depending on isPublic & isForm status */
    const visibleItems = computed<any[]>(() => (isPublic.value && isForm.value ? storedFiles.value : attachments.value))

    /** for bulk download */
    const selectedVisibleItems = ref<boolean[]>(Array.from({ length: visibleItems.value.length }, () => false))

    /** remove a file from our stored attachments (either locally stored or saved ones) */
    function removeFile(i: number) {
      if (isPublic.value) {
        storedFiles.value.splice(i, 1)
        attachments.value.splice(i, 1)
        selectedVisibleItems.value.splice(i, 1)

        updateModelValue(storedFiles.value)
      } else {
        attachments.value.splice(i, 1)
        selectedVisibleItems.value.splice(i, 1)

        updateModelValue(JSON.stringify(attachments.value))
      }
    }

    /** save a file on select / drop, either locally (in-memory) or in the db */
    async function onFileSelect(selectedFiles: FileList | File[]) {
      if (!selectedFiles.length) return

      const attachmentMeta = {
        ...defaultAttachmentMeta,
        ...(typeof column.value?.meta === 'string' ? JSON.parse(column.value.meta) : column.value?.meta),
      }

      const newAttachments = []

      const files: File[] = []

      for (const file of selectedFiles) {
        if (appInfo.value.ee) {
          // verify number of files
          if (visibleItems.value.length + selectedFiles.length > attachmentMeta.maxNumberOfAttachments) {
            message.error(
              `You can only upload at most ${attachmentMeta.maxNumberOfAttachments} file${
                attachmentMeta.maxNumberOfAttachments > 1 ? 's' : ''
              } to this cell.`,
            )
            return
          }

          // verify file size
          if (file.size > attachmentMeta.maxAttachmentSize * 1024 * 1024) {
            message.error(`The size of ${file.name} exceeds the maximum file size ${attachmentMeta.maxAttachmentSize} MB.`)
            continue
          }

          // verify mime type
          if (
            !attachmentMeta.supportedAttachmentMimeTypes.includes('*') &&
            !attachmentMeta.supportedAttachmentMimeTypes.includes(file.type) &&
            !attachmentMeta.supportedAttachmentMimeTypes.includes(file.type.split('/')[0])
          ) {
            message.error(`${file.name} has the mime type ${file.type} which is not allowed in this column.`)
            continue
          }
        }

        files.push(file)
      }

      if (isPublic.value && isForm.value) {
        const newFiles = await Promise.all<AttachmentType>(
          Array.from(files).map(
            (file) =>
              new Promise<AttachmentType>((resolve) => {
                const res: { file: File; title: string; mimetype: string; data?: any } = {
                  ...file,
                  file,
                  title: file.name,
                  mimetype: file.type,
                }

                if (isImage(file.name, (<any>file).mimetype ?? file.type)) {
                  const reader = new FileReader()

                  reader.onload = (e) => {
                    res.data = e.target?.result

                    resolve(res)
                  }

                  reader.onerror = () => {
                    resolve(res)
                  }

                  reader.readAsDataURL(file)
                } else {
                  resolve(res)
                }
              }),
          ),
        )
        attachments.value = [...attachments.value, ...newFiles]

        return updateModelValue(attachments.value)
      }

      try {
        const data = await api.storage.upload(
          {
            path: [NOCO, project.value.title, meta.value?.title, column.value?.title].join('/'),
          },
          {
            files,
            json: '{}',
          },
        )
        newAttachments.push(...data)
      } catch (e: any) {
        message.error(e.message || t('msg.error.internalError'))
      }

      updateModelValue(JSON.stringify([...attachments.value, ...newAttachments]))
    }

    async function renameFile(attachment: AttachmentType, idx: number) {
      return new Promise<boolean>((resolve) => {
        const { close } = useDialog(RenameFile, {
          title: attachment.title,
          onRename: (newTitle: string) => {
            attachments.value[idx].title = newTitle
            updateModelValue(JSON.stringify(attachments.value))
            close()
            resolve(true)
          },
          onCancel: () => {
            close()
            resolve(true)
          },
        })
      })
    }

    /** save files on drop */
    async function onDrop(droppedFiles: File[] | null) {
      if (droppedFiles) {
        // set files
        await onFileSelect(droppedFiles)
      }
    }

    /** bulk download selected files */
    async function bulkDownloadFiles() {
      await Promise.all(selectedVisibleItems.value.map(async (v, i) => v && (await downloadFile(visibleItems.value[i]))))
      selectedVisibleItems.value = Array.from({ length: visibleItems.value.length }, () => false)
    }

    /** download a file */
    async function downloadFile(item: AttachmentType) {
      ;(await import('file-saver')).saveAs(item.url || item.data, item.title)
    }

    /** construct the attachment url
     * See /packages/nocodb/src/lib/version-upgrader/ncAttachmentUpgrader.ts for the details
     * */
    async function getAttachmentUrl(item: AttachmentType) {
      const path = item?.path
      // if path doesn't exist, use `item.url`
      if (path) {
        // try ${appInfo.value.ncSiteUrl}/${item.path} first
        const url = `${appInfo.value.ncSiteUrl}/${item.path}`
        try {
          const res = await fetch(url)
          if (res.ok) {
            // use `url` if it is accessible
            return Promise.resolve(url)
          }
        } catch {
          // for some cases, `url` is not accessible as expected
          // do nothing here
        }
      }
      // if it fails, use the original url
      return Promise.resolve(item.url)
    }

    const FileIcon = (icon: string) => {
      switch (icon) {
        case 'mdi-pdf-box':
          return MdiPdfBox
        case 'mdi-file-word-outline':
          return MdiFileWordOutline
        case 'mdi-file-powerpoint-box':
          return MdiFilePowerpointBox
        case 'mdi-file-excel-outline':
          return MdiFileExcelOutline
        default:
          return IcOutlineInsertDriveFile
      }
    }

    watch(files, (nextFiles) => nextFiles && onFileSelect(nextFiles))

    return {
      attachments,
      visibleItems,
      isPublic,
      isForm,
      isReadonly,
      meta,
      column,
      editEnabled,
      isLoading,
      api,
      open: () => open(),
      onDrop,
      modalVisible,
      FileIcon,
      removeFile,
      renameFile,
      downloadFile,
      updateModelValue,
      selectedImage,
      selectedVisibleItems,
      storedFiles,
      bulkDownloadFiles,
      defaultAttachmentMeta,
      getAttachmentUrl,
    }
  },
  'useAttachmentCell',
)
