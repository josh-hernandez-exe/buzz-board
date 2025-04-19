import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/app/_components/ui/avatar";

export function GameUserAvatar({
  index,
  image,
}: {
  index: number;
  image: string | undefined | null;
}) {
  return (
    <Avatar>
      <AvatarImage
        src={image ?? undefined}
        referrerPolicy="no-referrer" // needed for google images to load
      />
      <AvatarFallback>P{index}</AvatarFallback>
    </Avatar>
  );
}
