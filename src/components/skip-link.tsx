import { cn } from "@/lib/utils";

interface SkipLinkProps {
  href?: string;
  className?: string;
}

export function SkipLink({ href = "#conteudo-principal", className }: SkipLinkProps) {
  return (
    <a href={href} className={cn("skip-link", className)}>
      Pular para o conteúdo principal
    </a>
  );
}
