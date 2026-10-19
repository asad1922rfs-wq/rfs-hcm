"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, NativeSelect } from "@/components/form";
import { EmptyState } from "@/components/common";
import { formatDate } from "@/lib/format";
import {
  DOCUMENT_ACCEPT, DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, formatBytes, MAX_DOCUMENT_BYTES, type DocumentCategory,
} from "@/core/documents/meta";
import { deleteDocumentAction } from "../actions";

export type DocumentRow = {
  id: string;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  expiresOn: Date | null;
  expiry: "expired" | "soon" | null;
};

const opensInline = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

/** Documents on an employee's record. Upload and delete appear only for document.manage. */
export function DocumentsPanel({
  employeeId, rows, canManage, description,
}: {
  employeeId: string;
  rows: DocumentRow[];
  canManage: boolean;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Documents</CardTitle>
          <CardDescription>{description ?? "CNIC, CV, contracts and certificates. Private to the employee and HR."}</CardDescription>
        </div>
        {canManage && <UploadDocumentDialog employeeId={employeeId} />}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No documents yet" description={canManage ? "Upload a PDF, image or Word file of up to 10 MB." : "HR has not added any documents to this record."} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="hidden lg:table-cell">File</TableHead>
                <TableHead className="hidden text-right md:table-cell">Size</TableHead>
                <TableHead className="hidden md:table-cell">Uploaded</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.title}</TableCell>
                  <TableCell className="hidden sm:table-cell">{DOCUMENT_CATEGORY_LABELS[d.category]}</TableCell>
                  <TableCell className="hidden max-w-56 truncate text-muted-foreground lg:table-cell" title={d.fileName}>{d.fileName}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatBytes(d.sizeBytes)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap md:table-cell">{formatDate(d.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {d.expiresOn ? (
                      <span className="inline-flex items-center gap-2">
                        <span className={d.expiry === "expired" ? "text-destructive" : d.expiry === "soon" ? "text-amber-600 dark:text-amber-400" : undefined}>
                          {formatDate(d.expiresOn)}
                        </span>
                        {d.expiry === "expired" && <Badge variant="destructive">Expired</Badge>}
                        {d.expiry === "soon" && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">Expiring soon</Badge>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        {opensInline(d.mimeType) ? (
                          <a href={`/api/v1/documents/${d.id}`} target="_blank" rel="noopener noreferrer"><Eye className="size-4" /> View</a>
                        ) : (
                          <a href={`/api/v1/documents/${d.id}?download=1`}><Download className="size-4" /> Download</a>
                        )}
                      </Button>
                      {canManage && <DeleteDocumentButton id={d.id} title={d.title} />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function UploadDocumentDialog({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>("CNIC");
  const [title, setTitle] = useState(DOCUMENT_CATEGORY_LABELS.CNIC);
  const [titleEdited, setTitleEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setCategory("CNIC");
    setTitle(DOCUMENT_CATEGORY_LABELS.CNIC);
    setTitleEdited(false);
    setError(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    if (file.size > MAX_DOCUMENT_BYTES) return setError(`This file is ${formatBytes(file.size)}. The limit is 10 MB.`);
    setPending(true);
    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/documents`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(body.error ?? (res.status === 413 ? "The file must be 10 MB or smaller." : "The upload failed. Try again."));
      toast.success("Document uploaded.");
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (pending) return; setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Upload className="size-4" /> Upload document</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>PDF, JPG, PNG, WEBP or Word (DOC/DOCX), up to 10 MB.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <Field label="Category" name="category" required>
            <NativeSelect
              id="f-category"
              name="category"
              value={category}
              onChange={(e) => {
                const next = e.target.value as DocumentCategory;
                setCategory(next);
                if (!titleEdited) setTitle(DOCUMENT_CATEGORY_LABELS[next]);
              }}
            >
              {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</option>)}
            </NativeSelect>
          </Field>
          <Field
            label="Title"
            name="title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }}
          />
          <Field
            label="Expires on"
            name="expiresOn"
            type="date"
            hint={category === "CNIC" ? "The CNIC expiry date, so HR is reminded before it lapses." : "Optional."}
          />
          <Field label="File" name="file" required>
            <Input id="f-file" name="file" type="file" accept={DOCUMENT_ACCEPT} required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />} Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDocumentButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${title}`}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{title}&rdquo;?</DialogTitle>
          <DialogDescription>The file is removed permanently. This is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteDocumentAction(id);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message ?? "Document deleted.");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
