import { AcademicAccess } from './academic.shared';
import { AcademicController } from './academic.controller';
import { AcademicService } from './academic.service';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

export const academicControllers = [
  AcademicController,
  ContentController,
  ActivitiesController,
];
export const academicProviders = [
  AcademicAccess,
  AcademicService,
  ContentService,
  ActivitiesService,
];
