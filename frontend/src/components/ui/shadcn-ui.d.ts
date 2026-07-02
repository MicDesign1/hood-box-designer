import type * as React from "react";

type UiProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
};

declare module "@/components/ui/button" {
  export const Button: React.FC<
    UiProps & {
      variant?: string;
      size?: string;
      disabled?: boolean;
    }
  >;
}

declare module "@/components/ui/card" {
  export const Card: React.FC<UiProps & { size?: string }>;
  export const CardHeader: React.FC<UiProps>;
  export const CardTitle: React.FC<UiProps>;
  export const CardDescription: React.FC<UiProps>;
  export const CardContent: React.FC<UiProps>;
  export const CardFooter: React.FC<UiProps>;
  export const CardAction: React.FC<UiProps>;
}

declare module "@/components/ui/input" {
  export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>>;
}

declare module "@/components/ui/label" {
  export const Label: React.FC<React.LabelHTMLAttributes<HTMLLabelElement>>;
}

declare module "@/components/ui/select" {
  export const Select: React.FC<{
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  }>;
  export const SelectTrigger: React.FC<UiProps & { size?: string }>;
  export const SelectValue: React.FC<UiProps>;
  export const SelectContent: React.FC<UiProps>;
  export const SelectItem: React.FC<UiProps & { value: string; disabled?: boolean }>;
  export const SelectGroup: React.FC<UiProps>;
  export const SelectLabel: React.FC<UiProps>;
  export const SelectSeparator: React.FC<UiProps>;
  export const SelectScrollUpButton: React.FC<UiProps>;
  export const SelectScrollDownButton: React.FC<UiProps>;
}