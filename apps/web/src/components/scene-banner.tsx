import Image from 'next/image';
import { SceneBanner as Banner, scenes } from '@my-platform/web-ui/scene-banner';
import type { ComponentProps } from 'react';

export function SceneBanner(props: Omit<ComponentProps<typeof Banner>, 'image'>) {
  return <Banner {...props} image={<Image src={`/images/radio-friday/${scenes[props.scene].image}`} alt="" fill sizes="(max-width: 767px) 100vw, 75vw" className="object-cover object-center" />} />;
}
