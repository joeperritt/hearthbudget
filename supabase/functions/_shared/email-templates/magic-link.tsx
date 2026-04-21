/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { styles } from './_brand.ts'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Keeper sign-in link</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Text style={styles.monogram}>K</Text>
          <Text style={styles.brandName}>KEEPER</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Sign in to Keeper</Heading>
          <Text style={styles.text}>
            Click below to securely sign in to your Keeper budget.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Sign In
            </Button>
          </Section>
          <div style={styles.divider} />
          <Text style={styles.fineprint}>
            This link expires in 24 hours. If you didn't request it, you can
            safely ignore this email.
          </Text>
        </Section>
        <Section style={styles.footer}>
          <Text style={styles.footerText}>Keeper · Budgeting together.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
